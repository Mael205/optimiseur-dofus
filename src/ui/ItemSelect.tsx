// Champ de recherche d'item avec suggestions (icône, niveau, type).

import { useMemo, useRef, useState } from "react";
import type { ItemIndex } from "../engine/worker";
import type { Slot } from "../engine/types";
import { norm } from "./format";

interface Props {
  items: ItemIndex[];
  slot?: Slot;
  maxLevel: number;
  /** Types acceptés (filtre du sélecteur de monture). */
  types?: string[];
  exclude?: Set<number>;
  placeholder: string;
  onPick: (item: ItemIndex) => void;
  autoFocus?: boolean;
}

const MAX_SHOWN = 40;

export function ItemIcon({ item, size = 32 }: { item?: { icon?: string; name: string } | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!item?.icon || broken)
    return <span className="item-icon placeholder" style={{ width: size, height: size }} aria-hidden />;
  return <img className="item-icon" src={item.icon} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />;
}

export function ItemSelect({ items, slot, maxLevel, types, exclude, placeholder, onPick, autoFocus }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return items
      .filter((it) => (!slot || it.slot === slot) && it.level <= maxLevel && (!types || types.includes(it.type)) && !exclude?.has(it.id))
      .filter((it) => {
        const n = norm(it.name);
        return words.every((w) => n.includes(w));
      })
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name, "fr"))
      .slice(0, MAX_SHOWN);
  }, [items, slot, maxLevel, types, exclude, q]);

  const pick = (it: ItemIndex) => {
    onPick(it);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="item-select">
      <input
        type="search"
        value={q}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(matches.length - 1, a + 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
          else if (e.key === "Enter" && matches[active]) pick(matches[active]);
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
          listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
        }}
      />
      {open && (
        <ul className="suggestions" ref={listRef} role="listbox">
          {matches.length === 0 && <li className="empty">Aucun item</li>}
          {matches.map((it, i) => (
            <li
              key={it.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it);
              }}
            >
              <ItemIcon item={it} size={28} />
              <span className="name">{it.name}</span>
              <span className="meta">
                {it.type} · niv. {it.level}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
