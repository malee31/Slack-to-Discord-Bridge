const databaseManager = require("./databaseManager.js");
const dataManager = require("./dataManager.js");
const Discord = require("discord.js");
const client = new Discord.Client();

let loggingGuild;

async function start() {
	await client.login(process.env.DISCORD_TOKEN);
	console.log(`===== Logged in as ${client.user.tag} ====`);
	try {
		await client.user.setPresence({
			activity: {
				type: "LISTENING",
				name: "To Slack Messages"
			},
			status: "online",
			afk: false
		});
		console.log("====== Successfully Set Presence ======");
	} catch (err) {
		console.warn("⚠⚠⚠⚠⚠ Failed to Set Presence ⚠⚠⚠⚠⚠");
		console.error(err);
	}

	try {
		console.log("======= Locating Logging Server =======");
		loggingGuild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
	} catch (locateError) {
		console.warn("⚠⚠ Failed to Locate Logging Server ⚠⚠");
		console.error(locateError);
		process.exit(1);
	}

	console.log("========== Discord Bot Ready ==========");
}

async function locateChannel(slackClient, slackChannelID) {
	let targetChannel = loggingGuild.channels.cache.get(dataManager.getChannel(slackChannelID));
	if(!targetChannel) {
		let channelInfo;
		try {
			channelInfo = await slackClient.conversations.info({channel: slackChannelID});
		} catch(channelInfoErr) {
			throw `Slack conversations.info error:\n${channelInfoErr}`;
		}
		if(!channelInfo.channel) {
			console.warn("No channelInfo.channel found: ", channelInfo);
			channelInfo.channel = {name: "unknown_channel_name"};
		}
		if(!channelInfo.channel.name) {
			console.warn("No channelInfo.channel.name found: ", channelInfo.channel);
			channelInfo.channel.name = "unknown_channel_name";
		}
		// Quirk: First occurrence of channel with the same name on Discord is used. The second occurrence is ignored
		targetChannel = await loggingGuild.channels.cache.find(channel => channel.type === "text" && channel.name === channelInfo.channel.name);
		if(!targetChannel) {
			try {
				targetChannel = await loggingGuild.channels.create(channelInfo.channel.name, {reason: `#${channelInfo.channel.name} created for new Slack Messages`});
			} catch(channelMakeErr) {
				// Use the line below instead of throwing if there is a default channel listed in serverMap.json you would like to send to instead of throwing
				// return loggingGuild.channels.cache.get(dataManager.getChannel(event.channel, true));
				throw `Channel #${channelInfo.channel.name} could not be found or created.\n${channelMakeErr}`;
			}
		}
		dataManager.mapChannel(slackChannelID, targetChannel.id);
	}
	return targetChannel;
}

// TODO: To make things easier, before sending the embeds, clone the timestamp and color onto the embeds from the main embed if they are not already set
async function embedSender(discordChannel, discordEmbeds, mapTo, canHaveText = true) {
	if(discordEmbeds.length > 1) discordEmbeds[0].setFooter(`↓ Message Includes ${discordEmbeds.length - 1} Additional Attachment${discordEmbeds.length === 2 ? "" : "s"} Below ↓`);
	for(const discordEmbed of discordEmbeds) {
		let sentMessage = await discordChannel.send(discordEmbed);
		if(mapTo) {
			databaseManager.messageMap(mapTo, sentMessage.id, canHaveText, err => {
				if(err) console.log(`MAP ERROR:\n${err}`);
				console.log(`Mapped Slack ${mapTo} to Discord ${sentMessage.id}`);
			});
			canHaveText = false;
		}
	}
}

async function slackTextParse(slackClient, text) {
	// Regex differs slightly from official regex defs_user_id in https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json
	// Known Bugs:
	// * Slow. Each mention slows down parsing significantly
	let mentions = text.match(/(?<=<@)[UW][A-Z0-9]{8}([A-Z0-9]{2})?(?=>)/g);
	if(mentions) {
		let identify = mentions.filter((id, index) => mentions.indexOf(id) === index).map(id => {
			return web.users.info({user: id});
		});
		(await Promise.all(identify)).forEach(userInfo => {
			text = text.replace(new RegExp(`<@${userInfo.user.id}>`, 'g'), `[${userIdentify(userInfo.user)}]`);
		});
	}

	// URL Slack to Discord Markdown Translation
	// Known Bugs:
	// * Including the character '>' in any part of the link's text will make the translation cut off early
	// * Certain non-urls will not parse correctly for some odd reason. For example, Slack will try to auto-encode text into a URL if it is entered as one and that won't sit well with Discord
	let urls = text.match(/(?<=<)https?:\/\/[\w@:%.\/+~#=]+(|.+?)?(?=>)/g);
	if(urls) {
		urls.map(link => {
			let split = link.split("|");
			text = text.replace(`<${link}>`, `[${split[1] && split[1].trim().length > 0 ? split[1].trim() : split[0]}](${split[0]})`);
		});
	}

	// Strikethrough Slack to Discord Markdown Translation
	// Known Bugs:
	// * Using Ctrl + Z on Slack to undo ~strikethrough~ markdown results in that undo being ignored on Discord. Escaped markdown is parsed as if it was never escaped
	text = text.replace(/~~/g, "\\~\\~").replace(/(?<=^|\s)(~(?=[^\s])[^~]+(?<=[^\s])~)(?=$|\s)/g, "~$1~");

	// Unescaping HTML Escapes created by Slack's API
	// Known Bugs:
	// * Literally typing any of the following HTML escape codes normally will result in them being converted over to their unescaped form on Discord
	// - Typing &gt; on Slack translates to > on Discord
	// - Typing &lt; on Slack translates to < on Discord
	// - Typing &amp; on Slack translates to & on Discord
	text = text.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

	// Additional Known Bugs:
	// * When using code blocks, if ```OneWord syntax is used on Slack, the first word is invisible when sent to Discord since it is understood as a programming language instead
	console.log(text);
	return text;
}

function userIdentify(user = {}) {
	if(!user.real_name || !user.id) return "Unknown Pupper";
	return `${user.real_name}@${user.id}`;
}

client.once("disconnect", () => {
	console.log("======= Disconnecting. Goodbye! =======");
	process.exit(1);
});

module.exports = {
	start,
	locateChannel,
	userIdentify,
	slackTextParse,
	embedSender
};