const axios = require("axios");
const fs = require("fs");
const cron = require("node-cron");

const apiList = require("./apis.json").apis;

async function checkAPI(url) {

    const start = Date.now();

    try {

        const response = await axios.get(url);

        const responseTime = Date.now() - start;

        const log = `[${new Date().toISOString()}] SUCCESS ${url} Status:${response.status} Time:${responseTime}ms\n`;

        console.log(log);

        fs.appendFileSync("logs.txt", log);

    } catch (error) {

        const responseTime = Date.now() - start;

        const log = `[${new Date().toISOString()}] ERROR ${url} Message:${error.message} Time:${responseTime}ms\n`;

        console.log(log);

        console.log("ALERT: API FAILURE DETECTED");

        fs.appendFileSync("logs.txt", log);
    }
}

async function monitorAPIs() {

    console.log("\nRunning API Health Check...\n");

    for (const api of apiList) {

        await checkAPI(api);

    }

    console.log("Monitoring cycle completed\n");
}

cron.schedule("*/1 * * * *", () => {

    monitorAPIs();

});