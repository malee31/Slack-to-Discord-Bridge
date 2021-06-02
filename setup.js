require("dotenv").config();
const prompts = require("prompts");
let prompted = {};

async function setup() {
	console.log("Beginning Setup Process");
	console.log("Testing Discord Token and Permissions");
	const Discord = require("discord.js");
	let client;
	prompted = await prompts({
		type: "text",
		name: "DISCORD_TOKEN",
		message: "Discord Bot Token: "
	});
	try {
		console.log("Testing Discord Bot Token");
		client = new Discord.Client();
		await client.login(prompted["DISCORD_TOKEN"]);
		console.log("Token Valid. Now Testing Permissions");
	} catch (err) {
		console.error(`Invalid Discord Token, try again\n${err}`);
	}
}

setup().then(() => {
	console.log("Successfully Set Up!");
}).catch(() => {
	console.error("Everything has gone wrong");
});