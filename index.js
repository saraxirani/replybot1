const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const LOGIN_FILE = path.join(__dirname, 'login.txt');
const TEXT_FILE = path.join(__dirname, 'textc.txt');
const EGYPT_WOEID = '23424802';

// Rate limit delays (in milliseconds)
// GET /2/tweets/search/recent: 1 request per 15 minutes
const SEARCH_INTERVAL = 15 * 60 * 1000 + 5000; // 15 minutes + 5 seconds buffer
// POST /2/tweets: 17 requests per 24 hours
const REPLY_INTERVAL = (24 * 60 * 60 * 1000) / 17 + 5000; // ~84 minutes + 5 seconds buffer

// In-memory store to track replied tweets and prevent duplicates
const repliedTweets = new Set();

/**
 * Reads API credentials from login.txt
 * @returns {object|null} An object with API keys or null if an error occurs.
 */
function getCredentials() {
    try {
        console.log(`Reading credentials from: ${LOGIN_FILE}`);
        const data = fs.readFileSync(LOGIN_FILE, 'utf8');
        const lines = data.split('\n');
        const credentials = {};
        lines.forEach(line => {
            const [key, value] = line.split('=');
            if (key && value) {
                credentials[key.trim()] = value.trim();
            }
        });
        if (!credentials.appKey || !credentials.appSecret || !credentials.accessToken || !credentials.accessSecret) {
            console.error('Error: login.txt is missing one or more required keys (appKey, appSecret, accessToken, accessSecret).');
            return null;
        }
        console.log('Successfully read credentials.');
        return credentials;
    } catch (error) {
        console.error(`Error reading login file: ${error.message}`);
        return null;
    }
}

/**
 * Reads reply texts from textc.txt
 * @returns {string[]} An array of reply texts.
 */
function getReplyTexts() {
    try {
        console.log(`Reading reply texts from: ${TEXT_FILE}`);
        const data = fs.readFileSync(TEXT_FILE, 'utf8');
        const texts = data.split('\n').filter(line => line.trim() !== '');
        console.log(`Found ${texts.length} possible reply texts.`);
        return texts;
    } catch (error) {
        console.error(`Error reading text file: ${error.message}`);
        return [];
    }
}

/**
 * Pauses execution for a specified duration while displaying a countdown.
 * @param {number} ms - The duration to sleep in milliseconds.
 * @param {string} reason - The reason for waiting.
 */
async function countdownSleep(ms, reason) {
    console.log(`Waiting due to rate limit (${reason})...`);
    let remaining = ms;
    while (remaining > 0) {
        const totalSeconds = Math.ceil(remaining / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        process.stdout.write(
            `Time remaining: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} \r`
        );

        await new Promise(resolve => setTimeout(resolve, 1000));
        remaining -= 1000;
    }
    process.stdout.write('\n'); // Move to the next line after countdown finishes
}

/**
 * The main function for the Twitter bot.
 */
async function main() {
    console.log('--- Twitter Bot Starting ---');

    const credentials = getCredentials();
    const replyTexts = getReplyTexts();

    if (!credentials || replyTexts.length === 0) {
        console.error('Exiting due to missing credentials or reply texts.');
        return;
    }

    try {
        const client = new TwitterApi({
            appKey: credentials.appKey,
            appSecret: credentials.appSecret,
            accessToken: credentials.accessToken,
            accessSecret: credentials.accessSecret,
        });

        const readWriteClient = client.readWrite;
        console.log('Twitter client initialized.');

        while (true) {
            console.log('\n--- Starting new cycle ---');
            try {
                // 1. Search for recent tweets in Egypt using the v2 API
                const searchQuery = 'Egypt lang:ar -is:retweet';
                console.log(`Searching for recent tweets in Egypt with query: ${searchQuery}`);

                // 2. Search for recent tweets based on the query
                const searchResult = await client.v2.search(searchQuery, { 'max_results': 10 });

                if (searchResult.meta.result_count === 0) {
                    console.log('No tweets found for the current trends.');
                } else {
                     // 3. Reply to tweets
                    for (const tweet of searchResult.data.data) {
                        if (repliedTweets.has(tweet.id)) {
                            console.log(`Already replied to tweet ID: ${tweet.id}. Skipping.`);
                            continue;
                        }

                        const randomReply = replyTexts[Math.floor(Math.random() * replyTexts.length)];
                        console.log(`Attempting to reply to tweet ID: ${tweet.id} with text: "${randomReply}"`);

                        await readWriteClient.v2.reply(randomReply, tweet.id);

                        repliedTweets.add(tweet.id);
                        console.log(`Successfully replied to tweet ID: ${tweet.id}.`);
                        await countdownSleep(REPLY_INTERVAL, 'next reply');
                    }
                }

            } catch (e) {
                if (e.data && e.data.status === 429 && e.rateLimit) {
                    const resetTimestamp = e.rateLimit.reset * 1000; // Convert to ms
                    const waitMs = Math.max(0, resetTimestamp - Date.now()) + 1000; // +1s buffer
                    console.error(`Rate limit hit! Waiting for API to reset.`);
                    await countdownSleep(waitMs, 'API rate limit reset');
                } else {
                    console.error('An error occurred during the cycle:', e);
                    // If a non-rate-limit error occurs, still wait before retrying
                    console.log('Waiting before next cycle due to error...');
                    await countdownSleep(SEARCH_INTERVAL, 'next search');
                }
            }
        }
    } catch (e) {
        console.error('A critical error occurred:', e);
    }
}

main();
