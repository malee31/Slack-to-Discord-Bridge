const https = require("https");
const path = require("path");
const fs = require("fs");

const downloadsFolder = path.resolve(__dirname, "downloads");
const pendingDownloads = [], pendingDeletions = [];
// Arbitrary. Used as the max number of attempts getValidFileName has for finding an available path to download a file to
// If the program doesn't crash or reject in-between the download and the deletion, this will most likely never be reached if kept over 10
const FILE_NAME_ITERATOR_LIMIT = 200;

module.exports = {
	downloadsFolder,
	fileDownload,
	fileDelete
}

async function fileDownload(fileObj, fileName) {
	fileName = fileName || fileObj.name;
	let split = fileName.split(".");
	let fileFormat = {extension: fileName.includes(".") ? split.pop() : "", name: split.join(".")};
	fileName = await getValidFileName(downloadsFolder, fileFormat.name, fileFormat.extension);

	let finalDownloadPath = path.resolve(downloadsFolder, fileName)
	pendingDownloads.push(finalDownloadPath);

	await completeDownload(finalDownloadPath, fileObj["url_private_download"], {
		Authorization: `Bearer ${process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN}`
	});

	// TODO: There is probably a way to get it from the headers while downloading the file
	const downloadSize = await fileSize(finalDownloadPath);

	return {
		name: fileObj.name,
		title: fileObj.title,
		path: finalDownloadPath,
		storedAs: fileName,
		extension: fileFormat.extension,
		size: downloadSize,
		original: fileObj
	};
}

async function getValidFileName(rootPath, fileName, fileExtension) {
	let testFileName = `${fileName}.${fileExtension}`;
	for(let copyCount = 1; copyCount <= FILE_NAME_ITERATOR_LIMIT; copyCount++) {
		let testPath = path.resolve(downloadsFolder, testFileName);
		try {
			await fs.promises.access(testPath, fs.constants.F_OK);
			// console.log(`File: ${testPath} already exists.\nAppending number to path and trying again`);
		} catch(err) {
			if(pendingDownloads.includes(testPath)) {
				// console.log(`Download named ${testPath} is already pending.\nAppending number to path and trying again`);
				continue;
			}
			if(err.code === "ENOENT") return testFileName;
			else console.warn("Unknown error while looking for a path to store download: ", err);
		}
		testFileName = `${fileName} (${copyCount}).${fileExtension}`;
	}
	throw `Could not download file after ${FILE_NAME_ITERATOR_LIMIT} attempts. Rejecting Promise.`;
}

function completeDownload(saveTo, downloadFromURL, headers = {}) {
	const saveFile = fs.createWriteStream(saveTo);
	return new Promise((resolve, reject) => {
		const request = https.get(downloadFromURL, {
			headers: headers
		}, response => {
			response.pipe(saveFile);
			saveFile.on('finish', async() => {
				await saveFile.close();
				// console.log(`Download Complete. Removing path from cache: ${finalDownloadPath}\n${pendingDownloads}`);
				const removed = pendingDownloads.splice(pendingDownloads.indexOf(saveTo), 1);
				// console.log(`Removed ${removed}`);
				resolve();
			});
		});

		request.on("error", async err => {
			// Delete the file asynchronously on fail. Doesn't check the result
			try {
				await fs.promises.unlink(saveTo)
			} catch(unlinkErr) {
				reject(`Download Failed and Unlink Failed: ${unlinkErr}`);
			}
			reject(`Download Failed: ${err}`);
		});
	});
}

async function fileSize(filePath) {
	return (await fs.promises.stat(filePath)).size / (1024 * 1024);
}

async function fileDelete(fileName) {
	let fileDeletePath = path.resolve(downloadsFolder, fileName);
	if(!pendingDeletions.includes(fileDeletePath)) {
		pendingDeletions.push(fileDeletePath);
		return fs.promises.unlink(fileDeletePath);
	}
}