import { NavLink } from "react-router-dom";

// The pages under Members (admin-only, like Members itself): who is on the
// team, and what they did. A segmented control, as the agent's tabs are.
const PAGES: [to: string, label: string][] = [
  ["/members", "Team"],
  ["/members/audit", "Audit log"],
];

export default function MembersNav() {
  return (
    <nav aria-label="Members" className="seg">
      {PAGES.map(([to, label]) => (
        // `end`: /members is not also current on /members/audit.
        <NavLink key={to} to={to} end>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
