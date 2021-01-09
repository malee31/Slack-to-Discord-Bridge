const fileManager = require("./fileManager.js");
const mime = require("mime-types");
const http = require("http");
const path = require("path");
const fs = require("fs");
module.exports = fsMake;

function fsMake(slackEvents) {
	http.createServer((req, res) => {
		if(req.url === "/slack/events") {
			slackEvents.requestListener()(req, res);
			return;
		}

		const filePath = path.resolve(fileManager.downloadsFolder, `.${decodeURIComponent(req.url)}`);
		console.log(`Accessing ${filePath}`);
		if(!filePath.startsWith(fileManager.downloadsFolder)) {
			console.warn(`Attempt to access ${filePath} detected and denied`);
			return;
		}
		if(process.env.DISABLE_FILE_SERVER && process.env.DISABLE_FILE_SERVER.trim().toLowerCase() === "true") {
			console.warn(`File Server is Disabled. File Request Denied`);
			res.writeHead(500, {"Content-Type": "text/plain"});
			res.write(`The file server is set to private and disabled.\nYour files are most likely still stored on the server so ask the server owner for it if you need it!`);
			res.end();
			return;
		}
		if(filePath === fileManager.downloadsFolder) {
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
			res.writeHead(200, {"Content-Type": contentType ? contentType : false});
			res.end(data, "UTF-8");
		});
	});
}