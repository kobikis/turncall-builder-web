import type { ProviderCard, Role } from "../integrations/ProviderAccounts";

export type { ProviderCard };

/** The account a role provider bills to, read off the cards' `serves`. */
export function cardFor(cards: ProviderCard[], role: Role, provider: string) {
  return cards.find((c) => c.serves[role]?.includes(provider));
}

/**
 * A note under a provider picker saying which key that provider will run on
 * (#48). A warning, never a block: a draft agent is not taking calls, and an
 * editor cannot enter a key themselves.
 */
export function ProviderKeyNote({
  role,
  provider,
  cards,
  pinned = false,
}: {
  role: Role;
  provider: string;
  cards: ProviderCard[];
  pinned?: boolean;
}) {
  if (pinned) return null; // the agent's own key wins; nothing to warn about
  const card = cardFor(cards, role, provider);
  if (!card || card.runs_on === "workspace" || card.runs_on === "unknown") return null;
  if (card.runs_on === "platform") {
    return (
      <p className="hint" style={{ margin: "4px 0 0" }}>
        Will use the platform's {card.provider} key — this workspace has not connected its own.
      </p>
    );
  }
  return (
    <p className="callout warn" role="note" style={{ margin: "4px 0 0" }}>
      No {card.provider} key: neither this workspace nor the platform has one, so calls will
      fail until an admin connects it on the Integrations page. You can still save.
    </p>
  );
}
