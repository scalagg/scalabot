import { 
    SlashCommandBuilder, 
    PermissionFlagsBits,
    ChatInputCommandInteraction,
    EmbedBuilder
} from 'discord.js';
import { ticketService } from '../../services/TicketService';
import { serverUtils } from '../../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('ticketcounter')
    .setDescription('Manage the ticket counter (Admin only)')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('view')
            .setDescription('View the current ticket counter')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('reset')
            .setDescription('Reset the ticket counter to 0')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('set')
            .setDescription('Set the ticket counter to a specific number')
            .addIntegerOption(option =>
                option
                    .setName('number')
                    .setDescription('The new ticket number')
                    .setRequired(true)
                    .setMinValue(0)
            )
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
        await interaction.reply({
            content: '❌ This command can only be used in a server.',
            ephemeral: true
        });
        return;
    }

    // Set server type based on guild ID
    serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

    // Check if user has admin permission
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasAdminRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. Admin role required.',
            ephemeral: true
        });
        return;
    }

    const subcommand = interaction.options.getSubcommand();

    try {
        switch (subcommand) {
            case 'view': {
                const currentNumber = await ticketService.getCurrentTicketNumber(interaction.guildId!);
                const embed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('primary'))
                    .setTitle('🎫 Ticket Counter')
                    .setDescription(`The current ticket counter is: **${currentNumber}**`)
                    .setFooter(serverUtils.getFooter())
                    .setTimestamp();

                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;
            }

            case 'reset': {
                await ticketService.resetTicketCounter(interaction.guildId!, 0);
                const embed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('success'))
                    .setTitle('🎫 Ticket Counter Reset')
                    .setDescription('The ticket counter has been reset to **0**')
                    .setFooter(serverUtils.getFooter())
                    .setTimestamp();

                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;
            }

            case 'set': {
                const newNumber = interaction.options.getInteger('number', true);
                await ticketService.resetTicketCounter(interaction.guildId!, newNumber);
                const embed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('success'))
                    .setTitle('🎫 Ticket Counter Updated')
                    .setDescription(`The ticket counter has been set to **${newNumber}**`)
                    .setFooter(serverUtils.getFooter())
                    .setTimestamp();

                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;
            }

            default:
                await interaction.reply({
                    content: '❌ Unknown subcommand.',
                    ephemeral: true
                });
        }
    } catch (error) {
        console.error('[TicketCounter] Error:', error);
        await interaction.reply({
            content: '❌ An error occurred while managing the ticket counter.',
            ephemeral: true
        });
    }
} 