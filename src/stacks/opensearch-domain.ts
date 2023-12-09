import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";

export class OpensearchDomainStack extends cdk.Stack {
  public readonly opensearchDomain: opensearch.IDomain;
  public readonly ingestionPipelineRole: iam.IRole;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domain = new opensearch.Domain(this, "Domain", {
      version: opensearch.EngineVersion.OPENSEARCH_2_11,
      capacity: {
        multiAzWithStandbyEnabled: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    /**
     * @see https://docs.aws.amazon.com/opensearch-service/latest/developerguide/pipeline-domain-access.html
     */
    const ingestionPipelineRole = new iam.Role(this, "IngestionRole", {
      assumedBy: new iam.ServicePrincipal("osis-pipelines.amazonaws.com", {
        conditions: {
          StringEquals: {
            "aws:SourceAccount": this.account,
          },
          ArnLike: {
            "aws:SourceArn": this.formatArn({
              service: "osis",
              resource: "pipeline",
              resourceName: "*",
            }),
          },
        },
      }),
      inlinePolicies: {
        ingestionPipeline: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["es:DescribeDomain"],
              resources: [domain.domainArn],
            }),
            new iam.PolicyStatement({
              actions: ["es:ESHttp*"],
              resources: [`${domain.domainArn}/*`],
            }),
          ],
        }),
      },
    });

    /**
     * @see https://docs.aws.amazon.com/opensearch-service/latest/developerguide/pipeline-domain-access.html#pipeline-access-domain
     */
    domain.addAccessPolicies(
      new iam.PolicyStatement({
        principals: [ingestionPipelineRole],
        actions: ["es:DescribeDomain", "es:ESHttp*"],
        resources: [`${domain.domainArn}/*`],
      }),
    );

    this.opensearchDomain = domain;
    this.ingestionPipelineRole = ingestionPipelineRole;
  }
}
