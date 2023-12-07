import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as trigger from "aws-cdk-lib/triggers";

export class PrerequisiteStack extends cdk.Stack {
  public readonly productCatalogTable: dynamodb.ITable;
  public readonly forumTable: dynamodb.ITable;
  public readonly threadTable: dynamodb.ITable;
  public readonly replyTable: dynamodb.ITable;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /**
     * //////////////
     * DynamoDB
     * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/AppendixSampleTables.html
     */

    const productCatalog = new dynamodb.Table(this, "ProductCatalog", {
      tableName: "ProductCatalog",
      partitionKey: { name: "Id", type: dynamodb.AttributeType.NUMBER },
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const forum = new dynamodb.Table(this, "Forum", {
      tableName: "Forum",
      partitionKey: { name: "Name", type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const thread = new dynamodb.Table(this, "Thread", {
      tableName: "Thread",
      partitionKey: { name: "ForumName", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "Subject", type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const reply = new dynamodb.Table(this, "Reply", {
      tableName: "Reply",
      partitionKey: { name: "Id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "ReplyDateTime", type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    reply.addGlobalSecondaryIndex({
      indexName: "PostedBy-Message-Index",
      partitionKey: { name: "PostedBy", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "Message", type: dynamodb.AttributeType.STRING },
    });

    /**
     * //////////////
     * Fixtures
     * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/AppendixSampleTables.html
     */

    const triggerHandler = new NodejsFunction(this, "TriggerHandler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        target: "node20",
        format: OutputFormat.ESM,
      },
    });
    productCatalog.grantWriteData(triggerHandler);
    forum.grantWriteData(triggerHandler);
    thread.grantWriteData(triggerHandler);
    reply.grantWriteData(triggerHandler);
    new trigger.Trigger(this, "Trigger", {
      handler: triggerHandler,
      executeAfter: [productCatalog, forum, thread, reply],
    });

    this.forumTable = forum;
    this.productCatalogTable = productCatalog;
    this.threadTable = thread;
    this.replyTable = reply;
  }
}
