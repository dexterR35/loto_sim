import { ChoiceChip, MetricCard, MetricGrid } from '../ui';
import { TicketCountControls } from './Loto649TicketUI';

export function StrategyTicketControls({
  strategies,
  strategy,
  onStrategyChange,
  ticketCount,
  onTicketCountChange,
  disabled = false
}) {
  const selected = strategies.find((item) => item.key === strategy) || strategies[0];

  return (
    <MetricGrid wide className={disabled ? 'pointer-events-none opacity-50' : ''}>
      <MetricCard label="Strategy" value={selected?.label} detail={selected?.description}>
        <div className="choice-row">
          {strategies.map(({ key, label, icon: Icon, description }) => (
            <ChoiceChip
              key={key}
              disabled={disabled}
              active={strategy === key}
              title={description}
              onClick={() => onStrategyChange(key)}
            >
              <Icon size={12} />
              {label}
            </ChoiceChip>
          ))}
        </div>
      </MetricCard>

      <MetricCard label="Tickets" detail="Combinations A · B · C">
        <TicketCountControls
          compact
          ticketCount={ticketCount}
          onTicketCountChange={onTicketCountChange}
          disabled={disabled}
        />
      </MetricCard>
    </MetricGrid>
  );
}
