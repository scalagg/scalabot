import { EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, Guild } from 'discord.js';
import { ServerUtils, ServerType } from '../utils/ServerUtils';

export interface HardcodedRole {
    name: string;
    emoji: string;
    description: string;
}

const ROLE_PRESETS: Record<ServerType, HardcodedRole[]> = {
    [ServerType.SCALA]: [
        { name: 'Announcements', emoji: '🛡️', description: 'Important server updates' },
        { name: 'Dev Updates', emoji: '🛡️', description: 'Development progress & changes' },
        { name: 'Giveaway Pings', emoji: '🛡️', description: 'Never miss a giveaway' },
        { name: 'Polls', emoji: '🛡️', description: 'Vote on server decisions' },
        { name: 'Store Updates', emoji: '🛡️', description: 'New items & sales' },
        { name: 'Maintenance Updates', emoji: '🛡️', description: 'Server maintenance notices' },
        { name: 'Events', emoji: '🛡️', description: 'Special events & tournaments' },
        { name: 'NA', emoji: '🛡️', description: 'North America' },
        { name: 'EU', emoji: '🛡️', description: 'Europe' },
        { name: 'AS', emoji: '🛡️', description: 'Asia' },
        { name: 'AU', emoji: '🛡️', description: 'Australia/Oceania' }
    ],
    [ServerType.HOLYPVP]: [
        { name: 'Staff Application', emoji: '📝', description: 'Get notified about staff applications' },
        { name: 'Update', emoji: '📰', description: 'Server updates and news' },
        { name: 'Key-All', emoji: '🗝️', description: 'Key-All events' },
        { name: 'Giveaway', emoji: '🎂', description: 'Giveaway notifications' },
        { name: 'Polls', emoji: '📊', description: 'Vote in server polls' },
        { name: 'Events', emoji: '🎉', description: 'Event notifications' },
        { name: 'Spanish', emoji: '🇪🇸', description: 'Spanish language chat' },
        { name: 'English', emoji: '🇺🇸', description: 'English language chat' },
        { name: 'Interested in PvP', emoji: '🗡️', description: 'PvP community' },
        { name: 'Interested in UHC', emoji: '🔥', description: 'UHC game mode' },
        { name: 'Interested in HCF', emoji: '🧪', description: 'HCF game mode' },
        { name: 'Interested in KitMap', emoji: '📦', description: 'KitMap game mode' },
        { name: 'Europe', emoji: '🇪🇺', description: 'Europe region' },
        { name: 'North America', emoji: '🇺🇸', description: 'North America region' },
        { name: 'Central America', emoji: '🇨🇦', description: 'Central America region' },
        { name: 'South America', emoji: '🇦🇷', description: 'South America region' },
        { name: 'Australia', emoji: '🇦🇺', description: 'Australia region' },
        { name: 'Asia', emoji: '🇦🇸', description: 'Asia region' },
        { name: 'Discovered via TikTok', emoji: '🎵', description: 'Found us on TikTok' },
        { name: 'Discovered via Instagram', emoji: '📸', description: 'Found us on Instagram' },
        { name: 'Discovered via Twitter', emoji: '🐦', description: 'Found us on Twitter' },
        { name: 'Discovered via YouTube', emoji: '▶️', description: 'Found us on YouTube' },
        { name: 'Discovered via Twitch', emoji: '🟣', description: 'Found us on Twitch' },
        { name: 'Discovered via Reddit', emoji: '👽', description: 'Found us on Reddit' },
        { name: 'Discovered via Discord', emoji: '💬', description: 'Found us on Discord' }
    ]
};

export class RoleMenuService {
    public getRolesForGuild(guildId: string): HardcodedRole[] {
        const type = ServerUtils.getInstance().getServerTypeFromGuildId(guildId);
        return ROLE_PRESETS[type] || [];
    }

    public createRoleMenuEmbed(guild: Guild): EmbedBuilder {
        const roles = this.getRolesForGuild(guild.id);
        const info = ServerUtils.getInstance().getInfo();
        let desc = 'Choose which roles you want to receive:\n\n';
        for (const role of roles) {
            desc += `${role.emoji} **${role.name}** - ${role.description}\n`;
        }
        desc += '\n_Select your roles below!_';
        return new EmbedBuilder()
            .setColor(ServerUtils.getInstance().getColor('primary'))
            .setTitle('Server Notifications')
            .setDescription(desc)
            .setFooter({ text: info.name, iconURL: info.logo });
    }

    public createRoleSelectMenu(guild: Guild): ActionRowBuilder<StringSelectMenuBuilder> {
        const roles = this.getRolesForGuild(guild.id);
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('role_selection')
            .setPlaceholder('Select your roles')
            .setMinValues(0)
            .setMaxValues(roles.length);
        for (const role of roles) {
            selectMenu.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(role.name)
                    .setEmoji(role.emoji)
                    .setValue(role.name)
            );
        }
        return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
    }
}

export const roleMenuService = new RoleMenuService(); 