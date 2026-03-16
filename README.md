API Health Monitoring Tool
Overview

The API Health Monitoring Tool is a lightweight Node.js utility that monitors the availability and performance of multiple REST APIs.
It performs automated health checks, tracks response times, detects failures, and logs operational data for troubleshooting and reliability monitoring.

This tool simulates a basic production monitoring system used in application support and DevOps environments.

Features

Automated API health checks

Response time monitoring

HTTP status code validation

Failure detection and alerting

Periodic monitoring using scheduled jobs

Logging of API status and performance metrics

Configurable API endpoints via JSON

Tech Stack

Node.js

Axios – HTTP client for API requests

node-cron – task scheduling

JSON configuration for API management

Project Structure
api-health-monitoring-tool
│
├── monitor.js        # Main monitoring script
├── apis.json         # List of APIs to monitor
├── logs.txt          # Generated log file
├── package.json
├── .gitignore
└── README.md
Installation

Clone the repository:

git clone https://github.com/AnoushkaNavale/Api-Health-Monitoring-Tool.git

Navigate to the project directory:

cd Api-Health-Monitoring-Tool

Install dependencies:

npm install
Configuration

Edit apis.json to add or modify the APIs you want to monitor.

Example:

{
  "apis": [
    "https://api.github.com",
    "https://jsonplaceholder.typicode.com/posts",
    "https://dog.ceo/api/breeds/image/random"
  ]
}
Running the Tool

Start the monitoring script:

node monitor.js

The tool will automatically check API health at scheduled intervals.

Example Output

Running API Health Check...

[2026-03-16T14:57:00.402Z] SUCCESS https://api.github.com Status:200 Time:377ms

[2026-03-16T14:57:00.481Z] SUCCESS https://jsonplaceholder.typicode.com/posts Status:200 Time:78ms

[2026-03-16T14:57:00.490Z] ERROR https://api.coindesk.com/v1/bpi/currentprice.json Message:getaddrinfo ENOTFOUND api.coindesk.com Time:8ms

ALERT: API FAILURE DETECTED
Monitoring cycle completed
