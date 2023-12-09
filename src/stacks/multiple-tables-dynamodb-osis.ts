import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as osis from "aws-cdk-lib/aws-osis";

type Props = cdk.StackProps & {
  tables: dynamodb.ITable[];
  domain: opensearch.IDomain;
  role: iam.IRole;
};
export class MultipleTablesDynamodbOsisStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);
    const { tables, domain, role } = props;

    /**
     * 既存のDynamoDB ItemsをOpenSearchに同期するためのS3バケット
     */
    const bucket = new s3.Bucket(this, "Bucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    /**
     * @see https://docs.aws.amazon.com/opensearch-service/latest/developerguide/configure-client-ddb.html#ddb-pipeline-role
     */
    role.attachInlinePolicy(
      new iam.Policy(this, "Policy", {
        statements: [
          new iam.PolicyStatement({
            sid: "allowRunExportJob",
            actions: [
              "dynamodb:DescribeTable",
              "dynamodb:DescribeContinuousBackups",
              "dynamodb:ExportTableToPointInTime",
            ],
            resources: tables.map((table) => table.tableArn + ""),
          }),
          new iam.PolicyStatement({
            sid: "allowCheckExportjob",
            actions: ["dynamodb:DescribeExport"],
            resources: tables.map((table) => table.tableArn + "/export/*"),
          }),
          new iam.PolicyStatement({
            sid: "allowReadFromStream",
            actions: [
              "dynamodb:DescribeStream",
              "dynamodb:GetRecords",
              "dynamodb:GetShardIterator",
            ],
            resources: tables.map((table) => table.tableArn + "/stream/*"),
          }),
          new iam.PolicyStatement({
            sid: "allowReadAndWriteToS3ForExport",
            actions: [
              "s3:GetObject",
              "s3:AbortMultipartUpload",
              "s3:PutObject",
              "s3:PutObjectAcl",
            ],
            resources: [bucket.bucketArn + "/*"],
          }),
        ],
      }),
    );

    /**
     * OSIS Pipeline
     */
    new osis.CfnPipeline(this, "OSISPipeline", {
      pipelineName: "multiple-tables-dynamodb",
      minUnits: 1,
      maxUnits: 4,
      pipelineConfigurationBody: /* yaml */ `
    
        version: "2"
        dynamodb-pipeline:
          source:
            dynamodb:
              acknowledgments: true
              tables: ${tables
                .map(
                  (table) => /* yaml */ `

                # REQUIRED: Supply the DynamoDB table ARN and whether export or stream processing is needed, or both
                - table_arn: ${table.tableArn}
                  # Remove the stream block if only export is needed
                  stream:
                    start_position: LATEST # TRIM_HORIZON does not work now. It will make pipeline unstable and cannot be deployed.
                  # Remove the export block if only stream is needed
                  export:
                    # REQUIRED for export: Specify the name of an existing S3 bucket for DynamoDB to write export data files to
                    s3_bucket: ${bucket.bucketName}
                    # Specify the region of the S3 bucket
                    s3_region: ${this.region}
                    # Optionally set the name of a prefix that DynamoDB export data files are written to in the bucket.
                    s3_prefix: multiple-table-${table.tableName}/

                `,
                )
                .join("")}
              aws:
                # REQUIRED: Provide the role to assume that has the necessary permissions to DynamoDB, OpenSearch, and S3.
                sts_role_arn: ${role.roleArn}
                # Provide the region to use for aws credentials
                region: ${this.region}
          sink:
            - opensearch:
                # REQUIRED: Provide an AWS OpenSearch endpoint
                hosts:
                  - https://${domain.domainEndpoint}
                index: multiple-tables-dynamodb-osis-index
                index_type: custom
                document_id: \${getMetadata("primary_key")}
                action: \${getMetadata("opensearch_action")}
                document_version: \${getMetadata("document_version")}
                document_version_type: external
                aws:
                  # REQUIRED: Provide a Role ARN with access to the domain. This role should have a trust relationship with osis-pipelines.amazonaws.com
                  sts_role_arn: ${role.roleArn}
                  # Provide the region of the domain.
                  region: ${this.region}
                  # Enable the 'serverless' flag if the sink is an Amazon OpenSearch Serverless collection
                  # serverless: true
                  # serverless_options:
                    # Specify a name here to create or update network policy for the serverless collection
                    # network_policy_name: "network-policy-name"
                # Enable the S3 DLQ to capture any failed requests in an S3 bucket. This is recommended as a best practice for all pipelines.
                # dlq:
                  # s3:
                    # Provide an S3 bucket
                    # bucket: "your-dlq-bucket-name"
                    # Provide a key path prefix for the failed requests
                    # key_path_prefix: "dynamodb-pipeline/dlq"
                    # Provide the region of the bucket.
                    # region: "us-east-1"
                    # Provide a Role ARN with access to the bucket. This role should have a trust relationship with osis-pipelines.amazonaws.com
                    # sts_role_arn: "arn:aws:iam::123456789012:role/Example-Role"
    
      `,
    });
  }
}
