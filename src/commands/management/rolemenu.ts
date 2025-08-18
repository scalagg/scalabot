import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, GuildMember, TextChannel } from 'discord.js';
import { roleMenuService } from '../../services/RoleMenuService';
import { serverUtils } from '../../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('rolemenu')
    .setDescription('Post the server role menu (hardcoded, per guild)')
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
        await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
        return;
    }
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasAdminRole(interaction.member)) {
        await interaction.reply({ content: '❌ You do not have permission to use this command. Admin role required.', ephemeral: true });
        return;
    }
    const channel = interaction.channel as TextChannel;
    const embed = roleMenuService.createRoleMenuEmbed(interaction.guild);
    const selectRow = roleMenuService.createRoleSelectMenu(interaction.guild);
    await channel.send({ embeds: [embed], components: [selectRow] });
    await interaction.reply({ content: '✅ Role menu posted!', ephemeral: true });
} 