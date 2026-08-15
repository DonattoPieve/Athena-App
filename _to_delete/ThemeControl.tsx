import { useEffect, useState } from "react";

const PALETTES = ["purple", "cyan", "blue", "matrix", "amber", "pink", "red"] as const;

export function ThemeControl() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [palette, setPalette] = useState<string>("purple");

  useEffect(() => {
    setTheme((localStorage.getItem("athena-theme") as "dark" | "light") ?? "dark");
    setPalette(localStorage.getItem("athena-palette") ?? "purple");
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("athena-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-palette", palette);
    localStorage.setItem("athena-palette", palette);
  }, [palette]);

  return (
    <div style={{ position: "relative" }}>
      <button
        className="btn"
        style={{ padding: "4px 8px", fontSize: 11 }}
        onClick={() => setOpen((o) => !o)}
        aria-label="Aparencia"
      >
        tema
      </button>
      {open && (
        <div
          className="card"
          style={{ position: "absolute", right: 0, top: "110%", padding: 12, zIndex: 20, width: 190 }}
        >
          <p className="label" style={{ margin: "0 0 6px" }}>Modo</p>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <button className="btn" style={{ flex: 1, padding: "4px 6px", fontSize: 11 }} onClick={() => setTheme("dark")}>escuro</button>
            <button className="btn" style={{ flex: 1, padding: "4px 6px", fontSize: 11 }} onClick={() => setTheme("light")}>claro</button>
          </div>
          <p className="label" style={{ margin: "0 0 6px" }}>Paleta</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
            {PALETTES.map((p) => (
              <button
                key={p}
                onClick={() => setPalette(p)}
                title={p}
                // O data-theme precisa vir junto: as variantes escuras sao
                // [data-theme="dark"][data-palette=...] no MESMO elemento. So
                // com data-palette, a bolinha mostrava a cor do modo claro.
                data-theme={theme}
                data-palette={p}
                style={{
                  height: 24,
                  borderRadius: "var(--r-md)",
                  border: palette === p ? "2px solid var(--c-text)" : "1px solid var(--c-border)",
                  background: "var(--c-accent)",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
