---
marp: true
title: Amazon DynamoDB zero-ETL integration with Amazon OpenSearch Service
description: DynamoDBからOpenSearch Serviceへのデータ連携が簡単にできるようになりました
author: yamatatsu
url: https://yamatatsu.github.io/dynsmodb-opensearch
image: https://yamatatsu.github.io/dynsmodb-opensearch/ogp.png
keywords: [aws, dynamodb, opensearch, cdk]
theme: default
transition: slide 300ms
style: |
  section.center p {
    text-align: center;
  }
  h1 {
    font-size: 48px;
  }
  h2 {
    font-size: 64px;
  }
  h3 {
    font-size: 48px;
  }
  p, li {
    font-size: 48px;
  }
---

# Amazon DynamoDB zero-ETL integration with Amazon OpenSearch Service

やまたつ
2023-12-11

---

<dev style="display: flex; justify-content: center; align-items: center; margin-top: 40px;">
  <img
    src="./yamatatsu.png"
    height="180"
    width="180"
  />
  <ul style="list-style-type: none; line-height: 1.4">
    <li style="font-size: 56px; font-weight: 700;">山本達也（やまたつ）</li>
    <li style="font-size: 32px; margin-bottom: 0px;">クラスメソッド株式会社</li>
    <li style="font-size: 32px; margin-bottom: 16px;">CX事業本部 デリバリー部</li>
    <li style="font-size: 24px; margin-bottom: 0px;">
      <a href="https://twitter.com/yamatatsu193">Twitter: @yamatatsu193</a>
    </li>
    <li style="font-size: 24px; margin-bottom: 16px;">
      <a href="https://github.com/yamatatsu">GitHub: @yamatatsu</a>
    </li>
  </ul>
</dev>

---

<iframe class="hatenablogcard" style="width:100%;height:155px;max-width:680px;" title="Amazon DynamoDB の Amazon OpenSearch Service とのゼロ ETL 統合が利用可能になりました | Amazon Web Services ブログ" src="https://hatenablog-parts.com/embed?url=https://aws.amazon.com/jp/blogs/news/amazon-dynamodb-zero-etl-integration-with-amazon-opensearch-service-is-now-generally-available/" width="300" height="150" frameborder="0" scrolling="no"></iframe>

---

やってみた

---

まずはDynamodbとそのデータを作る🛠️

---

<iframe class="hatenablogcard" style="width:100%;height:155px;max-width:680px;" title="DynamoDBが関連する機能の検証用にサンプル構成を作成するCDKを書いてみた | DevelopersIO" src="https://hatenablog-parts.com/embed?url=https://dev.classmethod.jp/articles/dynamodb-sample-data-cdk/" width="300" height="150" frameborder="0" scrolling="no"></iframe>

---

データできた✨

---

```ts
const domain = new opensearch.Domain(this, "Domain", {
  version: opensearch.EngineVersion.OPENSEARCH_2_11,
  capacity: {
    multiAzWithStandbyEnabled: false,
  },
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});
```

---

```ts
/**
 * 既存のDynamoDB ItemsをOpenSearchに同期するためのS3バケット
 */
const bucket = new s3.Bucket(this, "Bucket", {
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  autoDeleteObjects: true,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});
```

---

```ts
/**
 * OSIS Pipeline用のIAM Role
 */
const pipelineRole = new iam.Role(this, "IngestionRole", {
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
    /**
     * @see https://docs.aws.amazon.com/opensearch-service/latest/developerguide/pipeline-domain-access.html#pipeline-access-configure
     */
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
    /**
     * @see https://docs.aws.amazon.com/opensearch-service/latest/developerguide/configure-client-ddb.html#ddb-pipeline-role
     */
    dynamodbIngestion: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: "allowRunExportJob",
          actions: [
            "dynamodb:DescribeTable",
            "dynamodb:DescribeContinuousBackups",
            "dynamodb:ExportTableToPointInTime",
          ],
          resources: [table.tableArn + ""],
        }),
        new iam.PolicyStatement({
          sid: "allowCheckExportjob",
          actions: ["dynamodb:DescribeExport"],
          resources: [table.tableArn + "/export/*"],
        }),
        new iam.PolicyStatement({
          sid: "allowReadFromStream",
          actions: [
            "dynamodb:DescribeStream",
            "dynamodb:GetRecords",
            "dynamodb:GetShardIterator",
          ],
          resources: [table.tableArn + "/stream/*"],
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
  },
});
```

---

```ts
/**
 * OSIS PipelineのためのOpenSearchドメインのリソースポリシー
 * @see https://docs.aws.amazon.com/opensearch-service/latest/developerguide/pipeline-domain-access.html#pipeline-access-domain
 */
domain.addAccessPolicies(
  new iam.PolicyStatement({
    principals: [pipelineRole],
    actions: ["es:DescribeDomain", "es:ESHttp*"],
    resources: [`${domain.domainArn}/*`],
  }),
);
```

---

```ts
/**
 * OSIS Pipeline
 */
new osis.CfnPipeline(this, "OSISPipeline", {
  pipelineName: "simple-osis-pipeline",
  minUnits: 1,
  maxUnits: 4,
  pipelineConfigurationBody: `
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
          aws:
            sts_role_arn: ${pipelineRole.roleArn}
            region: ${this.region}
      sink:
        - opensearch:
            hosts:
              - https://${domain.domainEndpoint}
            index: table-index
            index_type: custom
            document_id: \${getMetadata("primary_key")}
            action: \${getMetadata("opensearch_action")}
            document_version: \${getMetadata("document_version")}
            document_version_type: external
            aws:
              sts_role_arn: ${pipelineRole.roleArn}
              region: ${this.region}
  `,
});
```

---

```yaml
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
      aws:
        sts_role_arn: ${pipelineRole.roleArn}
        region: ${this.region}
  sink:
    - opensearch:
        hosts:
          - https://${domain.domainEndpoint}
        index: table-index
        index_type: custom
        document_id: \${getMetadata("primary_key")}
        action: \${getMetadata("opensearch_action")}
        document_version: \${getMetadata("document_version")}
        document_version_type: external
        aws:
          sts_role_arn: ${pipelineRole.roleArn}
          region: ${this.region}
```
