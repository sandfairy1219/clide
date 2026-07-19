interface CostFooterProps {
  usage?: unknown;
  total_cost_usd?: number;
  num_turns?: number;
}

export function CostFooter({ usage, total_cost_usd, num_turns }: CostFooterProps) {
  return (
    <div className="cl-chat__cost">
      {total_cost_usd !== undefined && <span>${total_cost_usd.toFixed(4)}</span>}
      {num_turns !== undefined && <span>turns: {num_turns}</span>}
      {usage !== undefined && <span className="cl-chat__cost-raw">{JSON.stringify(usage)}</span>}
    </div>
  );
}
