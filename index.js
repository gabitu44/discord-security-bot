const { Client, GatewayIntentBits, Collection, EmbedBuilder, PermissionsBitField, ActivityType, REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  ownerIds: (process.env.OWNER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean),
  prefix: process.env.PREFIX || '!',
  logChannelId: process.env.LOG_CHANNEL_ID || null,
  muteRoleName: process.env.MUTE_ROLE_NAME || 'Muted',
  securityThreshold: Number(process.env.SECURITY_THRESHOLD || 5),
  lockdownEnabled: process.env.LOCKDOWN_DEFAULT === 'true',
};

const commands = new Collection();
const commandData = [];

function addCommand(command) {
  commands.set(command.name, command);
  if (command.slash) commandData.push(command.slash.toJSON());
}

function canManage(member, target) {
  if (!member || !target) return false;
  if (member.id === target.id) return false;
  if (member.id === member.guild.ownerId) return true;
  if (target.id === member.guild.ownerId) return false;
  if (member.roles.highest.position <= target.roles.highest.position) return false;
  return true;
}

function hasPermission(member, permission) {
  return member && member.permissions.has(permission);
}

async function sendLog(guild, title, description, color = 0x5865f2, fields = []) {
  const channelId = config.logChannelId;
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();

  if (fields.length > 0) embed.addFields(fields);

  try {
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error sending log:', error);
  }
}

function buildCommandHelp() {
  return [...commands.values()].map((cmd) => `• ${config.prefix}${cmd.name} - ${cmd.description}`).join('\n');
}

async function doLockdown(guild, enabled) {
  const everyone = guild.roles.everyone;
  const channels = guild.channels.cache.filter((ch) => ['GuildText', 'GuildVoice', 'GuildAnnouncement', 'GuildForum'].includes(ch.type));

  for (const channel of channels.values()) {
    await channel.permissionOverwrites.edit(everyone, {
      SendMessages: !enabled,
      Speak: !enabled,
      SendMessagesInThreads: !enabled,
      AddReactions: !enabled,
      Connect: !enabled,
      ViewChannel: true,
    }).catch(() => {});
  }

  await sendLog(guild, enabled ? 'Server Lockdown Enabled' : 'Server Lockdown Disabled', enabled ? 'The server is now locked down.' : 'The server lockdown has been removed.', enabled ? 0xff0000 : 0x00ff00);
}

addCommand({
  name: 'help',
  description: 'Display help information for the bot.',
  usage: `${config.prefix}help`,
  slash: new SlashCommandBuilder().setName('help').setDescription('Display help information for the bot.'),
  async execute(client, interactionOrMessage, args) {
    const embed = new EmbedBuilder()
      .setTitle('Security Bot Help')
      .setDescription('Bot moderation and anti-nuke commands')
      .setColor(0x5865f2)
      .addFields({ name: 'Commands', value: buildCommandHelp(), inline: false })
      .setTimestamp();

    if (interactionOrMessage.isCommand?.()) {
      return interactionOrMessage.reply({ embeds: [embed] });
    }

    return interactionOrMessage.reply({ embeds: [embed] });
  },
});

addCommand({
  name: 'ping',
  description: 'Check the bot latency.',
  usage: `${config.prefix}ping`,
  slash: new SlashCommandBuilder().setName('ping').setDescription('Check the bot latency.'),
  async execute(client, interactionOrMessage) {
    const latency = client.ws.ping;
    const embed = new EmbedBuilder().setTitle('Pong').setDescription(`🏓 Latency: ${latency}ms`).setColor(0x00ff00);
    if (interactionOrMessage.isCommand?.()) return interactionOrMessage.reply({ embeds: [embed] });
    return interactionOrMessage.reply({ embeds: [embed] });
  },
});

addCommand({
  name: 'ban',
  description: 'Ban a member from the server.',
  usage: `${config.prefix}ban @user [reason]`,
  slash: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server.')
    .addUserOption((option) => option.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the ban').setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers),
  async execute(client, interactionOrMessage, args) {
    const target = interactionOrMessage.options ? interactionOrMessage.options.getUser('user') : (await messageUserFromArgs(interactionOrMessage, args));
    if (!target) return sendReply(interactionOrMessage, 'Please provide a valid user.');

    const member = interactionOrMessage.guild ? await interactionOrMessage.guild.members.fetch(target.id).catch(() => null) : null;
    const mod = interactionOrMessage.member || (await interactionOrMessage.guild.members.fetch(interactionOrMessage.user.id));

    if (!hasPermission(mod, PermissionsBitField.Flags.BanMembers)) {
      return sendReply(interactionOrMessage, 'You do not have permission to ban members.');
    }

    if (member && !canManage(mod, member)) {
      return sendReply(interactionOrMessage, 'You cannot ban a member with equal or higher role hierarchy.');
    }

    const reason = interactionOrMessage.options ? interactionOrMessage.options.getString('reason') || 'No reason provided' : args.slice(1).join(' ') || 'No reason provided';
    await interactionOrMessage.guild.members.ban(target, { reason });

    const embed = new EmbedBuilder().setTitle('User Banned').setDescription(`${target.tag} has been banned.`).setColor(0xff0000).addFields({ name: 'Reason', value: reason }).setTimestamp();
    await sendReply(interactionOrMessage, { embeds: [embed] });
  },
});

addCommand({
  name: 'kick',
  description: 'Kick a member from the server.',
  usage: `${config.prefix}kick @user [reason]`,
  slash: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server.')
    .addUserOption((option) => option.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the kick').setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers),
  async execute(client, interactionOrMessage, args) {
    const target = interactionOrMessage.options ? interactionOrMessage.options.getUser('user') : (await messageUserFromArgs(interactionOrMessage, args));
    if (!target) return sendReply(interactionOrMessage, 'Please provide a valid user.');

    const member = interactionOrMessage.guild ? await interactionOrMessage.guild.members.fetch(target.id).catch(() => null) : null;
    const mod = interactionOrMessage.member || (await interactionOrMessage.guild.members.fetch(interactionOrMessage.user.id));

    if (!hasPermission(mod, PermissionsBitField.Flags.KickMembers)) {
      return sendReply(interactionOrMessage, 'You do not have permission to kick members.');
    }

    if (member && !canManage(mod, member)) {
      return sendReply(interactionOrMessage, 'You cannot kick a member with equal or higher role hierarchy.');
    }

    const reason = interactionOrMessage.options ? interactionOrMessage.options.getString('reason') || 'No reason provided' : args.slice(1).join(' ') || 'No reason provided';
    await member.kick(reason);

    const embed = new EmbedBuilder().setTitle('User Kicked').setDescription(`${target.tag} has been kicked.`).setColor(0xffa500).addFields({ name: 'Reason', value: reason }).setTimestamp();
    await sendReply(interactionOrMessage, { embeds: [embed] });
  },
});

addCommand({
  name: 'warn',
  description: 'Warn a member.',
  usage: `${config.prefix}warn @user reason`,
  slash: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member.')
    .addUserOption((option) => option.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the warning').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
  async execute(client, interactionOrMessage, args) {
    const target = interactionOrMessage.options ? interactionOrMessage.options.getUser('user') : (await messageUserFromArgs(interactionOrMessage, args));
    if (!target) return sendReply(interactionOrMessage, 'Please provide a valid user.');

    const reason = interactionOrMessage.options ? interactionOrMessage.options.getString('reason') : args.slice(1).join(' ');
    if (!reason) return sendReply(interactionOrMessage, 'Please provide a reason.');

    const embed = new EmbedBuilder().setTitle('User Warned').setDescription(`${target.tag} was warned.`).setColor(0xf1c40f).addFields({ name: 'Reason', value: reason }).setTimestamp();
    await sendReply(interactionOrMessage, { embeds: [embed] });
  },
});

addCommand({
  name: 'mute',
  description: 'Mute a member.',
  usage: `${config.prefix}mute @user [reason]`,
  slash: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute a member.')
    .addUserOption((option) => option.setName('user').setDescription('User to mute').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the mute').setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
  async execute(client, interactionOrMessage, args) {
    const target = interactionOrMessage.options ? interactionOrMessage.options.getUser('user') : (await messageUserFromArgs(interactionOrMessage, args));
    if (!target) return sendReply(interactionOrMessage, 'Please provide a valid user.');

    const member = interactionOrMessage.guild ? await interactionOrMessage.guild.members.fetch(target.id).catch(() => null) : null;
    const mod = interactionOrMessage.member || (await interactionOrMessage.guild.members.fetch(interactionOrMessage.user.id));

    if (!hasPermission(mod, PermissionsBitField.Flags.ModerateMembers)) {
      return sendReply(interactionOrMessage, 'You do not have permission to mute members.');
    }

    if (member && !canManage(mod, member)) {
      return sendReply(interactionOrMessage, 'You cannot mute a member with equal or higher role hierarchy.');
    }

    let mutedRole = interactionOrMessage.guild.roles.cache.find((role) => role.name === config.muteRoleName);
    if (!mutedRole) {
      mutedRole = await interactionOrMessage.guild.roles.create({
        name: config.muteRoleName,
        color: 0x000000,
        reason: 'Automatically created mute role',
      });
    }

    for (const channel of interactionOrMessage.guild.channels.cache.values()) {
      await channel.permissionOverwrites.edit(mutedRole, {
        SendMessages: false,
        Speak: false,
        AddReactions: false,
        SendMessagesInThreads: false,
      }).catch(() => {});
    }

    const reason = interactionOrMessage.options ? interactionOrMessage.options.getString('reason') || 'No reason provided' : args.slice(1).join(' ') || 'No reason provided';
    await member.roles.add(mutedRole, reason);

    const embed = new EmbedBuilder().setTitle('User Muted').setDescription(`${target.tag} has been muted.`).setColor(0x5865f2).addFields({ name: 'Reason', value: reason }).setTimestamp();
    await sendReply(interactionOrMessage, { embeds: [embed] });
  },
});

addCommand({
  name: 'unmute',
  description: 'Unmute a member.',
  usage: `${config.prefix}unmute @user`,
  slash: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Unmute a member.')
    .addUserOption((option) => option.setName('user').setDescription('User to unmute').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
  async execute(client, interactionOrMessage, args) {
    const target = interactionOrMessage.options ? interactionOrMessage.options.getUser('user') : (await messageUserFromArgs(interactionOrMessage, args));
    if (!target) return sendReply(interactionOrMessage, 'Please provide a valid user.');

    const member = interactionOrMessage.guild ? await interactionOrMessage.guild.members.fetch(target.id).catch(() => null) : null;
    if (!member) return sendReply(interactionOrMessage, 'That user is not in this server.');

    const mutedRole = interactionOrMessage.guild.roles.cache.find((role) => role.name === config.muteRoleName);
    if (!mutedRole) return sendReply(interactionOrMessage, 'No mute role exists for this server.');

    await member.roles.remove(mutedRole).catch(() => {});
    const embed = new EmbedBuilder().setTitle('User Unmuted').setDescription(`${target.tag} has been unmuted.`).setColor(0x00ff00).setTimestamp();
    await sendReply(interactionOrMessage, { embeds: [embed] });
  },
});

addCommand({
  name: 'lockdown',
  description: 'Lock or unlock all text/voice channels.',
  usage: `${config.prefix}lockdown [true|false]`,
  slash: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Lock or unlock the server.')
    .addBooleanOption((option) => option.setName('enabled').setDescription('Enable or disable lockdown').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  async execute(client, interactionOrMessage, args) {
    const enabled = interactionOrMessage.options ? interactionOrMessage.options.getBoolean('enabled') : (args[0] === 'true' || args[0] === 'on');
    await doLockdown(interactionOrMessage.guild, enabled);
    await sendReply(interactionOrMessage, `Lockdown is now ${enabled ? 'enabled' : 'disabled'}.`);
  },
});

addCommand({
  name: 'vanity',
  description: 'Check the guild vanity invite/status.',
  usage: `${config.prefix}vanity`,
  slash: new SlashCommandBuilder().setName('vanity').setDescription('Check the guild vanity invite/status.').setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
  async execute(client, interactionOrMessage) {
    try {
      const vanity = await interactionOrMessage.guild.fetchVanityData();
      const embed = new EmbedBuilder()
        .setTitle('Vanity Invite')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Code', value: vanity.code || 'None', inline: true },
          { name: 'Uses', value: String(vanity.uses || 0), inline: true },
          { name: 'Invite', value: vanity.code ? `https://discord.gg/${vanity.code}` : 'None', inline: false },
        )
        .setTimestamp();
      await sendReply(interactionOrMessage, { embeds: [embed] });
    } catch (error) {
      await sendReply(interactionOrMessage, 'Could not fetch vanity data for this server.');
    }
  },
});

addCommand({
  name: 'clear',
  description: 'Delete a number of messages in a channel.',
  usage: `${config.prefix}clear 10`,
  slash: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Delete messages from a channel.')
    .addIntegerOption((option) => option.setName('count').setDescription('Number of messages to delete').setRequired(true).setMinValue(1).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
  async execute(client, interactionOrMessage, args) {
    const count = interactionOrMessage.options ? interactionOrMessage.options.getInteger('count') : Number(args[0]);
    if (!count || count < 1) return sendReply(interactionOrMessage, 'Please provide a valid number of messages to delete.');

    const channel = interactionOrMessage.channel;
    const messages = await channel.messages.fetch({ limit: count });
    await channel.bulkDelete(messages, true).catch(() => {});

    const embed = new EmbedBuilder().setTitle('Messages Deleted').setDescription(`Deleted ${messages.size} messages.`).setColor(0x5865f2).setTimestamp();
    await sendReply(interactionOrMessage, { embeds: [embed] });
  },
});

addCommand({
  name: 'status',
  description: 'View the bot status and settings.',
  usage: `${config.prefix}status`,
  slash: new SlashCommandBuilder().setName('status').setDescription('View the bot status and settings.'),
  async execute(client, interactionOrMessage) {
    const embed = new EmbedBuilder()
      .setTitle('Bot Status')
      .setDescription('The security bot is online and monitoring this server.')
      .addFields(
        { name: 'Ping', value: `${client.ws.ping}ms`, inline: true },
        { name: 'Guilds', value: `${client.guilds.cache.size}`, inline: true },
        { name: 'Prefix', value: config.prefix, inline: true },
      )
      .setColor(0x00ff00)
      .setTimestamp();

    await sendReply(interactionOrMessage, { embeds: [embed] });
  },
});

async function messageUserFromArgs(message, args) {
  const mention = args[0]?.match(/<@!?(\d+)>/);
  if (mention) return client.users.cache.get(mention[1]) || await client.users.fetch(mention[1]).catch(() => null);

  if (!args[0]) return null;
  const user = client.users.cache.find((u) => u.username.toLowerCase() === args[0].toLowerCase());
  if (user) return user;

  return null;
}

async function sendReply(interactionOrMessage, content) {
  if (interactionOrMessage.isCommand && typeof interactionOrMessage.reply === 'function') {
    return interactionOrMessage.reply(content);
  }

  if (interactionOrMessage.channel && typeof interactionOrMessage.reply === 'function') {
    return interactionOrMessage.reply(content);
  }

  return null;
}

client.on('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setPresence({ activities: [{ name: 'Protecting your server', type: ActivityType.Watching }], status: 'online' });

  const rest = new REST({ version: '10' }).setToken(config.token);

  if (config.clientId && config.guildId) {
    try {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commandData });
      console.log('✅ Slash commands registered.');
    } catch (error) {
      console.error('Error registering slash commands:', error);
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(client, interaction);
  } catch (error) {
    console.error('Interaction error:', error);
    await interaction.reply({ content: 'There was an error while running that command.', ephemeral: true });
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  const command = commands.get(commandName);
  if (!command) return;

  try {
    await command.execute(client, message, args);
  } catch (error) {
    console.error('Message command error:', error);
  }
});

client.on('guildMemberAdd', async (member) => {
  await sendLog(member.guild, 'Member Joined', `${member.user.tag} joined the server.`, 0x00ff00, [
    { name: 'User', value: member.user.tag, inline: true },
    { name: 'ID', value: member.id, inline: true },
  ]);
});

client.on('guildMemberRemove', async (member) => {
  await sendLog(member.guild, 'Member Left', `${member.user.tag} left the server.`, 0xffa500, [
    { name: 'User', value: member.user.tag, inline: true },
    { name: 'ID', value: member.id, inline: true },
  ]);
});

client.on('guildBanAdd', async (ban) => {
  const guild = ban.guild;
  const audit = await guild.fetchAuditLogs({ limit: 5, type: 22 }).catch(() => null);
  const entry = audit?.entries.first();

  if (!entry) return;

  const executor = await guild.members.fetch(entry.executor.id).catch(() => null);
  if (!executor) return;

  const recentBanCount = (await guild.bans.fetch({ limit: 10 })).size;
  if (recentBanCount >= config.securityThreshold) {
    await doLockdown(guild, true);
    await sendLog(guild, 'Mass Ban Detected', `${executor.user.tag} triggered a mass ban event and lockdown was enabled.`, 0xff0000, [
      { name: 'Executor', value: executor.user.tag, inline: true },
      { name: 'Ban Count', value: String(recentBanCount), inline: true },
    ]);
  }
});

client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;

  const audit = await channel.guild.fetchAuditLogs({ limit: 3, type: 10 }).catch(() => null);
  const entry = audit?.entries.first();
  const executor = entry ? await channel.guild.members.fetch(entry.executor.id).catch(() => null) : null;

  if (!executor) return;

  if (!executor.permissions.has(PermissionsBitField.Flags.Administrator) && !config.ownerIds.includes(executor.id)) {
    await channel.delete('Possible malicious channel creation detected.');
    await sendLog(channel.guild, 'Suspicious Channel Creation', `${executor.user.tag} created a channel that has been removed.`, 0xff0000, [
      { name: 'Executor', value: executor.user.tag, inline: true },
      { name: 'Channel', value: channel.name, inline: true },
    ]);
  }
});

client.on('roleCreate', async (role) => {
  if (!role.guild) return;

  const audit = await role.guild.fetchAuditLogs({ limit: 3, type: 30 }).catch(() => null);
  const entry = audit?.entries.first();
  const executor = entry ? await role.guild.members.fetch(entry.executor.id).catch(() => null) : null;

  if (!executor) return;

  if (!executor.permissions.has(PermissionsBitField.Flags.Administrator) && !config.ownerIds.includes(executor.id)) {
    await role.delete('Possible malicious role creation detected.');
    await sendLog(role.guild, 'Suspicious Role Creation', `${executor.user.tag} created a role that has been removed.`, 0xff0000, [
      { name: 'Executor', value: executor.user.tag, inline: true },
      { name: 'Role', value: role.name, inline: true },
    ]);
  }
});

client.on('messageDelete', async (message) => {
  if (!message.guild || message.author?.bot) return;
  await sendLog(message.guild, 'Message Deleted', `A message was deleted in #${message.channel.name}.`, 0xffa500, [
    { name: 'User', value: message.author.tag, inline: true },
    { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
    { name: 'Content', value: message.content.slice(0, 1000) || 'No content', inline: false },
  ]);
});

if (!config.token) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

client.login(config.token);

module.exports = { commands, config };
