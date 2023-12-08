import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as osis from "aws-cdk-lib/aws-osis";
import { PrerequisiteStack } from "./stacks/prerequisite";
import { SimpleStack } from "./stacks/simple";

const app = new cdk.App();

const tables = new PrerequisiteStack(app, "DynamoDB2OpenSearchPrerequisite");

new SimpleStack(app, "DynamoDB2OpenSearchSimple", {
  table: tables.productCatalogTable,
});
