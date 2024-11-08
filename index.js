require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes, ApplicationCommandOptionType } = require('discord-api-types/v10');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = 3000;

let roleMappings = {};
let roleMessageId = null;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions
    ]
});

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const commands = [
    {
        name: 'preview',
        description: 'Generates a preview for a provided DCinside link.',
        options: [
            {
                name: 'link',
                type: ApplicationCommandOptionType.String,
                description: 'DCinside link',
                required: true,
            },
        ],
    },
    {
        name: 'setrolechannel',
        description: 'Choose a channel for role selection messages.',
        options: [
            {
                name: 'channel',
                type: ApplicationCommandOptionType.Channel,
                description: 'Channel to send role selection message',
                required: true,
            },
        ],
    },
    {
        name: 'addrolemapping',
        description: 'Map an emoji to a role.',
        options: [
            {
                name: 'emoji',
                type: ApplicationCommandOptionType.String,
                description: 'Emoji (format: <emoji_name:emoji_id>)',
                required: true,
            },
            {
                name: 'role',
                type: ApplicationCommandOptionType.Role,
                description: 'Role to assign',
                required: true,
            },
        ],
    },
    {
        name: 'listrolemappings',
        description: 'Displays current emoji-role mappings.',
    },
    {
        name: 'deleterolemapping',
        description: 'Deletes an emoji-role mapping.',
        options: [
            {
                name: 'emoji',
                type: ApplicationCommandOptionType.String,
                description: 'Emoji to delete (format: <emoji_name:emoji_id>)',
                required: true,
            },
        ],
    },
];

// 서버 시작 부분
app.get('/status', (req, res) => res.send('[갤주봇]: Running!'));
app.listen(PORT, () => console.log(`서버 시작 - http://localhost:${PORT}`));

// 커맨드 등록 부분
client.once('ready', async () => {
    console.log('[갤주봇] 커맨드 등록중 ...');
    for (const guild of client.guilds.cache.values()) {
        try {
            await rest.put(
                Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guild.id),
                { body: commands }
            );
            console.log(`+ 커맨드 등록 완료 서버 ID: ${guild.id}`);
        } catch (error) {
            console.error(`- 커맨드 등록 실패 서버 ID: ${guild.id}:`, error);
        }
    }
});

// 커맨드 인터렉션별 함수 실행
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'preview') {
        handlePreviewCommand(interaction, options);
    } else if (commandName === 'setrolechannel') {
        handleSetRoleChannelCommand(interaction, options);
    } else if (commandName === 'addrolemapping') {
        handleAddRoleMappingCommand(interaction, options);
    } else if (commandName === 'listrolemappings') {
        handleListRoleMappingsCommand(interaction);
    } else if (commandName === 'deleterolemapping') {
        handleDeleteRoleMappingCommand(interaction, options);
    }
});

async function handlePreviewCommand(interaction, options) {
    const url = options.getString('link');
    if (!url.includes('dcinside')) {
        await interaction.reply('Only dcinside.com links are allowed!');
        return;
    }

    try {
        const response = await axios.get(url, { headers: { Referer: url } });
        const $ = cheerio.load(response.data);
        const title = $('meta[name="twitter:title"]').attr('content') || $('title').text() || 'No Title';
        const author = title.substring(title.indexOf('- ')+1, title.length);
        let description = $('meta[name="twitter:description"]').attr('content') || 'No Description';
        if (description.length > 100) description = description.substring(0, 100) + '...';
        const recommendText = $('.up_num.font_red').first().text().trim();

        const embed = new EmbedBuilder()
            .setAuthor({ name: author })
            .setTitle(title)
            .setDescription(description)
            .setURL(url)
            .setColor('Blue')
            .addFields({ name: 'Recommendations', value: recommendText || '-', inline: true });

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error fetching link data:', error);
        await interaction.reply('Failed to fetch link data.');
    }
}

async function handleSetRoleChannelCommand(interaction, options) {
    const channel = options.getChannel('channel');
    const roleMessage = await channel.send('Select a role:');
    roleMessageId = roleMessage.id;

    for (let emojiId in roleMappings) {
        try {
            const emoji = client.emojis.cache.get(emojiId);
            if (emoji) await roleMessage.react(emoji);
        } catch (error) {
            console.error(`이모지 로드 실패 --- ${emojiId}:`, error);
        }
    }
    await interaction.reply({ content: `Role selection message sent to ${channel}`, ephemeral: true });
}

async function handleAddRoleMappingCommand(interaction, options) {
    const emojiInput = options.getString('emoji');
    const role = options.getRole('role');
    const emojiId = emojiInput.match(/\d+/)?.[0];

    if (!emojiId) {
        await interaction.reply({ content: 'Invalid emoji format. Use `<emoji_name:emoji_id>`.', ephemeral: true });
        return;
    }

    roleMappings[emojiId] = { fullName: emojiInput, roleId: role.id };
    await interaction.reply({ content: `Mapped ${emojiInput} to role ${role.name}`, ephemeral: true });
}

async function handleListRoleMappingsCommand(interaction) {
    if (Object.keys(roleMappings).length === 0) {
        await interaction.reply({ content: 'No emoji-role mappings set.', ephemeral: true });
        return;
    }

    const mappingsList = Object.entries(roleMappings)
        .map(([emojiId, { fullName, roleId }]) => {
            const role = interaction.guild.roles.cache.get(roleId);
            return `${fullName} → ${role ? role.name : 'Deleted Role'}`;
        })
        .join('\n');

    await interaction.reply({ content: `Current emoji-role mappings:\n${mappingsList}`, ephemeral: true });
}

async function handleDeleteRoleMappingCommand(interaction, options) {
    const emojiInput = options.getString('emoji');
    const emojiId = emojiInput.match(/\d+/)?.[0];

    if (!emojiId || !roleMappings[emojiId]) {
        await interaction.reply({ content: 'Mapping not found for that emoji.', ephemeral: true });
        return;
    }

    delete roleMappings[emojiId];
    await interaction.reply({ content: `Deleted mapping for ${emojiInput}`, ephemeral: true });
}

client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.message.id !== roleMessageId || user.bot) return;
    const roleId = roleMappings[reaction.emoji.id]?.roleId;

    if (roleId) {
        const guildMember = reaction.message.guild.members.cache.get(user.id);
        if (guildMember) {
            guildMember.roles.add(roleId).catch(error => console.error(`Failed to add role: ${error}`));
        }
    }
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (reaction.message.id !== roleMessageId || user.bot) return;
    const roleId = roleMappings[reaction.emoji.id]?.roleId;

    if (roleId) {
        const guildMember = reaction.message.guild.members.cache.get(user.id);
        if (guildMember) {
            guildMember.roles.remove(roleId).catch(error => console.error(`Failed to remove role: ${error}`));
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
