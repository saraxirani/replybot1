const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const REPLIED_TWEETS_LOG = path.join(__dirname, 'replied_tweets.log');

/**
 * Reads replied tweet IDs from the log file.
 * @returns {Set<string>} A set of replied tweet IDs.
 */
function loadRepliedTweets() {
    if (!fs.existsSync(REPLIED_TWEETS_LOG)) {
        return new Set();
    }
    const data = fs.readFileSync(REPLIED_TWEETS_LOG, 'utf8');
    return new Set(data.split('\n').filter(id => id.trim() !== ''));
}

/**
 * Appends a new replied tweet ID to the log file.
 * @param {string} tweetId - The ID of the tweet that was replied to.
 */
function saveRepliedTweet(tweetId) {
    fs.appendFileSync(REPLIED_TWEETS_LOG, `${tweetId}\n`);
}

/**
 * The main function for the Twitter bot, designed for a single run.
 */
async function main() {
    console.log('--- Twitter Bot Action Starting ---');
    const EGYPT_WOEID = '23424802';

    // 1. Get credentials and reply text from environment variables
    const { APP_KEY, APP_SECRET, ACCESS_TOKEN, ACCESS_SECRET, TEXT_CONTENT } = process.env;
    if (!APP_KEY || !APP_SECRET || !ACCESS_TOKEN || !ACCESS_SECRET || !TEXT_CONTENT) {
        console.error('Error: Missing one or more required environment variables.');
        process.exit(1);
    }
    const replyTexts = TEXT_CONTENT.split('|').filter(line => line.trim() !== '');
    if (replyTexts.length === 0) {
        console.error('Error: No reply texts found in TEXT_CONTENT environment variable.');
        process.exit(1);
    }

    try {
        // 2. Initialize Twitter client
        const client = new TwitterApi({
            appKey: APP_KEY,
            appSecret: APP_SECRET,
            accessToken: ACCESS_TOKEN,
            accessSecret: ACCESS_SECRET,
        });
        const readWriteClient = client.readWrite;
        console.log('Twitter client initialized.');

        // 3. Fetch trending hashtag
        let trendingHashtag = '';
        try {
            console.log(`Fetching trends for Egypt (WOEID: ${EGYPT_WOEID})...`);
            const trends = await client.v1.trendsByPlace(EGYPT_WOEID);
            // Find the first trend that is a valid hashtag
            trendingHashtag = trends[0]?.trends?.find(t => t.name.startsWith('#'))?.name || '';
            if (trendingHashtag) {
                console.log(`Found trending hashtag: ${trendingHashtag}`);
            } else {
                console.log('No trending hashtag found.');
            }
        } catch (trendError) {
            console.error('Could not fetch trends. Continuing without a trending hashtag.', trendError);
            // This might fail if the app doesn't have v1.1 access, but the bot can continue.
        }

        // 4. Load previously replied tweets
        const repliedTweets = loadRepliedTweets();
        console.log(`Loaded ${repliedTweets.size} replied tweet IDs from log.`);

        // 5. Search for recent tweets
        const searchQuery = 'Egypt lang:ar -is:retweet';
        console.log(`Searching for recent tweets with query: ${searchQuery}`);
        const searchResult = await client.v2.search(searchQuery, { 'max_results': 20 });

        if (searchResult.meta.result_count === 0) {
            console.log('No new tweets found. Exiting.');
            return;
        }

        // 6. Find a new tweet and reply
        for (const tweet of searchResult.data.data) {
            if (repliedTweets.has(tweet.id)) {
                console.log(`Already replied to tweet ID: ${tweet.id}. Skipping.`);
                continue;
            }

            let replyContent = replyTexts[Math.floor(Math.random() * replyTexts.length)];
            if (trendingHashtag) {
                replyContent += ` ${trendingHashtag}`;
            }

            console.log(`Attempting to reply to new tweet ID: ${tweet.id} with: "${replyContent}"`);
            await readWriteClient.v2.reply(replyContent, tweet.id);

            saveRepliedTweet(tweet.id);
            console.log(`Successfully replied and logged tweet ID: ${tweet.id}.`);
            console.log('Action completed. Exiting.');
            return; // Exit after the first successful reply
        }

        console.log('No new tweets to reply to in the latest search results. Exiting.');

    } catch (e) {
        console.error('A critical error occurred during the action:', e);
        process.exit(1);
    }
}

main();
