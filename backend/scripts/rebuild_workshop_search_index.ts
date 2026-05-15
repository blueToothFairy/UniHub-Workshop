import "dotenv/config";
import { PgDatabase } from "../src/shared/infra/pgDatabase.js";
import { ElasticsearchWorkshopSearchAdapter } from "../src/modules/workshop/elasticsearch-workshop-search.adapter.js";
import { WorkshopSearchIndexService } from "../src/modules/workshop/workshop-search-index.service.js";

async function main(): Promise<void> {
  const service = new WorkshopSearchIndexService(new PgDatabase(), new ElasticsearchWorkshopSearchAdapter());
  if (!service.isConfigured()) {
    throw new Error("Elasticsearch is not configured. Set ELASTICSEARCH_URL before rebuilding the index.");
  }

  await service.rebuildIndex();
  // eslint-disable-next-line no-console
  console.log("Workshop search index rebuilt successfully.");
}

void main();
