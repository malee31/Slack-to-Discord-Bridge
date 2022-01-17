const Flags = require("discord.js").Intents.FLAGS;

// Comment and uncomment to enable or disable
module.exports = [
	Flags.GUILDS,
	Flags.GUILD_MEMBERS,
	// Flags.GUILD_BANS,
	Flags.GUILD_EMOJIS_AND_STICKERS,
	// Flags.GUILD_INTEGRATIONS,
	// Flags.GUILD_WEBHOOKS,
	// Flags.GUILD_INVITES,
	// Flags.GUILD_VOICE_STATES,
	// Flags.GUILD_PRESENCES,
	Flags.GUILD_MESSAGES,
	Flags.GUILD_MESSAGE_REACTIONS,
	// Flags.GUILD_MESSAGE_TYPING,
	Flags.DIRECT_MESSAGES,
	Flags.DIRECT_MESSAGE_REACTIONS,
	// Flags.DIRECT_MESSAGE_TYPING
];