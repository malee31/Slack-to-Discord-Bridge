const https = require("https");
const path = require("path");
const fs = require("fs");
const downloadsFolder = path.resolve(__dirname, "downloads");

module.exports = {
	downloadsFolder,
	fileDownload,
	fileDelete
}

let pendingDownloads = [];

async function fileDownload(fileObj, fileName) {
	fileName = fileName || fileObj.name;
	let copyCount = 0;
	let split = fileName.split(".");
	let fileFormat = {extension: fileName.includes(".") ? split.pop() : "", name: split.join(".")};
	while(true) {
		let testFileName = `${fileFormat.name}${copyCount ? ` (${copyCount})` : ""}.${fileFormat.extension}`;
		let testPath = path.resolve(downloadsFolder, testFileName);
		try {
			await fs.promises.access(testPath, fs.constants.F_OK);
			console.log(`File: ${testPath} already exists.\nAppending number to path and trying again`);
			copyCount++;
		} catch(err) {
			if(err.code === "ENOENT") {
				if(pendingDownloads.includes(testPath)) {
					console.log(`Download named ${testPath} is already pending.\nAppending number to path and trying again`);
					copyCount++;
					continue;
				} else {
					fileName = testFileName;
					break;
				}
			}
			console.warn("Unknown error while looking for a path to store download: ", err);

			// Arbitrary number used as limit
			if(copyCount > 200) throw "Could not download file after 200 attempts. Rejecting Promise.";
		}
	}

	let finalDownloadPath = path.resolve(downloadsFolder, fileName)
	pendingDownloads.push(finalDownloadPath);

	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(path.resolve(downloadsFolder, fileName));
		const request = https.get(fileObj["url_private_download"], {
			headers: {
				Authorization: `Bearer ${process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN}`
			}
		}, response => {
			response.pipe(file);
			file.on('finish', async() => {
				await file.close();
				console.log(`Download Complete. Removing path from cache: ${finalDownloadPath}`);
				console.log(pendingDownloads);
				pendingDownloads.splice(pendingDownloads.indexOf(finalDownloadPath), 1);
				console.log(pendingDownloads);
				resolve({
					name: fileObj.name,
					title: fileObj.title,
					storedAs: fileName,
					path: file.path
				});
			});
		});

		request.on("error", async err => {
			// Delete the file asynchronously on fail. Doesn't check the result
			await fs.promises.unlink(path.resolve(downloadsFolder, fileName).catch(err2 => {
				if(err2) reject(`Download Failed and Unlink Failed: ${err2}`);
			}));
			reject(`Download Failed: ${err}`);
		});
	});
}

let pendingDeletions = [];

async function fileDelete(fileName) {
	let fileDeletePath = path.resolve(downloadsFolder, fileName);
	if(pendingDeletions.includes(fileDeletePath)) return;
	pendingDeletions.push(fileDeletePath);

	return fs.promises.unlink(fileDeletePath);
}