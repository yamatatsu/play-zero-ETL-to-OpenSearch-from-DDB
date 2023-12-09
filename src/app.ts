import * as cdk from "aws-cdk-lib";
import { PrerequisiteStack } from "./stacks/prerequisite";
import { OpensearchDomainStack } from "./stacks/opensearch-domain";
import { SimpleDynamodbOsisStack } from "./stacks/simple-dynamodb-osis";
// import { MultipleTablesDynamodbOsisStack } from "./stacks/multiple-tables-dynamodb-osis";

const app = new cdk.App();

const tables = new PrerequisiteStack(app, "DynamoDB2OpenSearchPrerequisite");
const domain = new OpensearchDomainStack(app, "DynamoDB2OpenSearchDomain");

new SimpleDynamodbOsisStack(app, "DynamoDB2OpenSearchSimple", {
  table: tables.productCatalogTable,
  domain: domain.opensearchDomain,
  role: domain.ingestionPipelineRole,
});

/**
 * This stack cannot deploy because of the following error:
 *
 * > Exactly one DynamoDB table is required for Amazon OpenSearch Ingestion pipelines using a dynamodb source: "$['dynamodb-pipeline']['source']['dynamodb']"
 */
//
// new MultipleTablesDynamodbOsisStack(app, "DynamoDB2OpenSearchMultipleTable", {
//   tables: [
//     tables.productCatalogTable,
//     tables.forumTable,
//     tables.replyTable,
//     tables.threadTable,
//   ],
//   domain: domain.opensearchDomain,
//   role: domain.ingestionPipelineRole,
// });
