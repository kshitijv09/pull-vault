import { query } from "../src/db";

async function main() {
  try {
    const res = await query("SELECT * FROM auction_bid_increment_rules ORDER BY min_price ASC;");
    console.log("Auction Bid Increment Rules:");
    console.table(res.rows);
  } catch (err) {
    console.error("Error querying auction_bid_increment_rules:", err);
  } finally {
    process.exit(0);
  }
}

main();
