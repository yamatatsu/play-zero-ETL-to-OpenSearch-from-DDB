import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as trigger from "aws-cdk-lib/triggers";

const app = new cdk.App();
const stack = new cdk.Stack(app, "PlayZeroEtlToOpenSearchFromDdb");

const productCatalog = new dynamodb.Table(stack, "ProductCatalog", {
  tableName: "ProductCatalog",
  partitionKey: { name: "Id", type: dynamodb.AttributeType.NUMBER },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const forum = new dynamodb.Table(stack, "Forum", {
  tableName: "Forum",
  partitionKey: { name: "Name", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const thread = new dynamodb.Table(stack, "Thread", {
  tableName: "Thread",
  partitionKey: { name: "ForumName", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "Subject", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const reply = new dynamodb.Table(stack, "Reply", {
  tableName: "Reply",
  partitionKey: { name: "Id", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "ReplyDateTime", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});
reply.addGlobalSecondaryIndex({
  indexName: "PostedBy-Message-Index",
  partitionKey: { name: "PostedBy", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "Message", type: dynamodb.AttributeType.STRING },
});

const triggerHandler = new NodejsFunction(stack, "TriggerHandler", {
  runtime: lambda.Runtime.NODEJS_20_X,
  architecture: lambda.Architecture.ARM_64,
});
productCatalog.grantWriteData(triggerHandler);
forum.grantWriteData(triggerHandler);
thread.grantWriteData(triggerHandler);
reply.grantWriteData(triggerHandler);
new trigger.Trigger(stack, "Trigger", {
  handler: triggerHandler,
  executeAfter: [productCatalog, forum, thread, reply],
});
