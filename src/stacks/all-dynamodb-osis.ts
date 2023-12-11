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
export class AllDynamodbOsisStack extends cdk.Stack {
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

    tables.forEach((table) => {
      /**
       * OSIS Pipeline
       */
      new osis.CfnPipeline(this, table.node.id + "OSISPipeline", {
        pipelineName: table.node.id.toLowerCase() + "-osis",
        minUnits: 1,
        maxUnits: 4,
        pipelineConfigurationBody: /* yaml */ `

          version: "2"
          dynamodb-pipeline:
            source:
              dynamodb:
                acknowledgments: true
                tables:
                  - table_arn: ${table.tableArn}
                    stream:
                      start_position: LATEST
                    export:
                      s3_bucket: ${bucket.bucketName}
                      s3_region: ${this.region}
                      s3_prefix: ${table.node.id.toLowerCase()}/
                aws:
                  sts_role_arn: ${role.roleArn}
                  region: ${this.region}
            sink:
              - opensearch:
                  hosts:
                    - https://${domain.domainEndpoint}
                  index: ${table.node.id.toLowerCase()}
                  index_type: custom
                  document_id: \${getMetadata("primary_key")}
                  action: \${getMetadata("opensearch_action")}
                  document_version: \${getMetadata("document_version")}
                  document_version_type: external
                  aws:
                    sts_role_arn: ${role.roleArn}
                    region: ${this.region}

        `,
      });
    });
  }
}
