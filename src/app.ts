import * as cdk from "aws-cdk-lib";
import { PrerequisiteStack } from "./stacks/prerequisite";
import { OpensearchDomainStack } from "./stacks/opensearch-domain";
import { SimpleDynamodbOsisStack } from "./stacks/simple-dynamodb-osis";
// import { MultipleTablesDynamodbOsisStack } from "./stacks/multiple-tables-dynamodb-osis";
// import { MultiplePipelinesDynamodbOsisStack } from "./stacks/multiple-pipelines-dynamodb-osis";
import { AllDynamodbOsisStack } from "./stacks/all-dynamodb-osis";

const app = new cdk.App();

const tables = new PrerequisiteStack(app, "DynamoDB2OpenSearchPrerequisite");
const domain = new OpensearchDomainStack(app, "DynamoDB2OpenSearchDomain");

// new SimpleDynamodbOsisStack(app, "DynamoDB2OpenSearchSimple", {
//   table: tables.productCatalogTable,
//   domain: domain.opensearchDomain,
//   role: domain.ingestionPipelineRole,
// });

new AllDynamodbOsisStack(app, "DynamoDB2OpenSearchAll", {
  tables: [
    tables.productCatalogTable,
    tables.forumTable,
    tables.replyTable,
    tables.threadTable,
  ],
  domain: domain.opensearchDomain,
  role: domain.ingestionPipelineRole,
});

new OpensearchDomainStack(app, "OpenSearchPlayground");

/**
 * This stack cannot deploy because of the following error:
 *
 * > Exactly one DynamoDB table is required for Amazon OpenSearch Ingestion pipelines using a dynamodb source: "$['dynamodb-pipeline']['source']['dynamodb']"
 */
//
// new MultipleTablesDynamodbOsisStack(app, "DynamoDB2OpenSearchMultipleTables", {
//   tables: [
//     tables.productCatalogTable,
//     tables.forumTable,
//     tables.replyTable,
//     tables.threadTable,
//   ],
//   domain: domain.opensearchDomain,
//   role: domain.ingestionPipelineRole,
// });

/**
 * This stack cannot deploy because of the following error:
 *
 * > Exactly one non "pipeline" source is required for Amazon OpenSearch Ingestion pipelines.
 */
// new MultiplePipelinesDynamodbOsisStack(
//   app,
//   "DynamoDB2OpenSearchMultiplePipelines",
//   {
//     tables: [
//       tables.productCatalogTable,
//       tables.forumTable,
//       tables.replyTable,
//       tables.threadTable,
//     ],
//     domain: domain.opensearchDomain,
//     role: domain.ingestionPipelineRole,
//   },
// );
