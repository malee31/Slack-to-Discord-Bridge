const fileManager = require("./fileManager.js");
const mime = require("mime-types");
const http = require("http");
const path = require("path");
const fs = require("fs");

/**
 * An adapter for Slack’s Events API.
 * @external SlackEventAdapter
 * @see https://slack.dev/node-slack-sdk/reference/events-api
 */

/**
 * Creates the simple file server for downloads and adds in the Slack events listener to the server
 * @param {SlackEventAdapter} slackEvents The event adapter for Slack from {@link https://slack.dev/node-slack-sdk/reference/events-api|require("@slack/events-api").createEventAdapter}
 * @module fileServer
 */
module.exports = fsMake;

function fsMake(slackEvents) {
	return http.createServer((req, res) => {
		if(req.url === "/slack/events") {
			slackEvents.requestListener()(req, res);
			return;
		}

		const filePath = path.resolve(fileManager.DOWNLOADS_FOLDER, `.${decodeURIComponent(req.url.split("?")[0])}`);
		console.log(`[${new Date().toLocaleString()}] Accessing ${filePath} from ${req.url}`);
		if(!filePath.startsWith(fileManager.DOWNLOADS_FOLDER)) {
			console.warn(`Attempt to access ${filePath} detected and denied`);
			return;
		}
		if(process.env.DISABLE_FILE_SERVER?.trim().toLowerCase() === "true") {
			console.warn(`File Server is Disabled. File Request Denied`);
			res.writeHead(500, {"Content-Type": "text/plain"});
			res.write(`The file server is set to private and disabled.\nYour files are most likely still stored on the server so ask the server owner for it if you need it!`);
			res.end();
			return;
		}
		if(filePath === fileManager.DOWNLOADS_FOLDER) {
			if(process.env.DISABLE_FILE_SERVER_LIST?.trim().toLowerCase() !== "true") {
				fs.readdir(filePath, (err, files) => {
					if(err) {
						console.warn("Error Reading Downloads Folder");
						res.writeHead(500, {"Content-Type": "text/plain"});
						res.write(`Error Reading Downloads Folder: \n${err}`);
						res.end();
						return;
					}
					res.writeHead(200, {"Content-Type": "text/plain"});
					res.write(`Download Folder Contents:\n`);
					files.forEach(file => {
						res.write(`${file}\n`);
					});
					res.end();
				});
			} else {
				res.writeHead(200, {"Content-Type": "text/plain"});
				res.write("List of files stored on the server will not be listed because DISABLE_FILE_SERVER_LIST is set to TRUE.\nEach specific file is still accessible through their respective urls");
				res.end();
			}
			return;
		}
		fs.readFile(filePath, (err, data) => {
			if(err) {
				console.warn(`Error reading file from downloads: ${err}`);
				res.writeHead(200, {"Content-Type": "text/plain"});
				res.write(`Error reading file from downloads (${filePath}): \n${err}`);
				res.end();
				return;
			}
			const contentType = mime.lookup(filePath);
			res.writeHead(200, {
				"Content-Type": contentType ?? false,
				"Content-Disposition": req.url.toLowerCase().split("?")[1]?.includes("download") ? "attachment" : "inline"
			});
			res.end(data, "UTF-8");
		});
	});
}