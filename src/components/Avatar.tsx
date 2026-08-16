import type { Account } from "../lib/api";

/**
 * Avatar da conta. Sem foto, cai na inicial sobre a cor de destaque — o mesmo
 * desenho que a lateral já usava, agora num lugar só.
 *
 * `key={url}` força o Chromium a refazer a requisição quando a URL muda. Como
 * cada upload gera um nome novo isso raramente importa, mas remover a foto e
 * pôr outra na mesma sessão exercita exatamente esse caminho.
 */
export function Avatar({ conta, tamanho = 20 }: { conta: Account; tamanho?: number }) {
  const inicial = (conta.name || conta.email || "?").slice(0, 1).toUpperCase();

  if (conta.avatarUrl) {
    return (
      <img
        key={conta.avatarUrl}
        className="avatar"
        src={conta.avatarUrl}
        alt=""
        width={tamanho}
        height={tamanho}
        style={{ width: tamanho, height: tamanho }}
      />
    );
  }

  return (
    <span
      className="avatar bolinha"
      style={{ width: tamanho, height: tamanho, fontSize: Math.max(10, tamanho * 0.45) }}
    >
      {inicial}
    </span>
  );
}
