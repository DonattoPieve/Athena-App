/**
 * Passo a passo de como usar o Athena — abre em janela própria (`win:ajuda`).
 *
 * Janela, e não aba: quem está aprendendo precisa LER e FAZER ao mesmo tempo,
 * e uma aba obriga a trocar de tela a cada passo. Menor que a janela de
 * trabalho porque é uma coluna de texto, não um painel de três colunas.
 *
 * O texto está em português direto, sem `t()`. O arquivo é quase todo prosa, e
 * quarenta chamadas de tradução deixariam ilegível justamente o texto que mais
 * precisa ser relido e corrigido. O `t()` devolveria português mesmo, já que
 * não há tradução para estas frases — quando o app tiver inglês de verdade,
 * esta tela vira um par de arquivos, não uma sopa de chamadas.
 */

type PassoProps = {
  n: number;
  titulo: string;
  children: React.ReactNode;
};

function Passo({ n, titulo, children }: PassoProps) {
  return (
    <section className="ajuda-passo">
      <span className="ajuda-num" aria-hidden>
        {n}
      </span>
      <div className="ajuda-corpo">
        <h2>{titulo}</h2>
        {children}
      </div>
    </section>
  );
}

/** Tecla, com a mesma cara do `kbd` do resto do app. */
function K({ children }: { children: React.ReactNode }) {
  return <kbd className="ajuda-tecla">{children}</kbd>;
}

export function Ajuda() {
  return (
    <div className="ajuda scroll">
      <header className="ajuda-topo">
        <h1>Como usar o Athena</h1>
        <p>
          O Athena transforma o material do professor mais a sua anotação de aula numa página
          organizada, e guarda tudo na sua conta. Em ordem, do zero ao primeiro resumo pronto.
        </p>
      </header>

      <Passo n={1} titulo="Entre com a sua conta">
        <p>
          É a mesma conta em qualquer computador. Ao entrar pela primeira vez numa máquina nova, o
          app prepara seus arquivos sozinho e baixa o texto que já é seu: as anotações e os resumos.
        </p>
        <p className="ajuda-nota">
          O material pesado do professor não desce todo de uma vez — ele aparece na árvore com um
          ícone de nuvem e vem no primeiro clique. É por isso que abrir o app num PC novo leva
          segundos, e não meia hora.
        </p>
      </Passo>

      <Passo n={2} titulo="Entenda as duas colunas da esquerda">
        <p>
          <strong>Notes</strong> é o que entra: <em>INATEL</em> guarda o material oficial de cada
          matéria (PDF, slides) e as outras pastas guardam o que você escreve.
        </p>
        <p>
          <strong>Resumos</strong> é o que sai: as páginas que o Athena gerou. Elas são somente
          leitura — corrigir conteúdo ali é gerar de novo, não editar à mão.
        </p>
      </Passo>

      <Passo n={3} titulo="Coloque o material da matéria">
        <p>
          Arraste a pasta da matéria — ou os PDFs soltos — do Explorer do Windows direto para cima
          de <strong>Notes/INATEL</strong>. Pode soltar em cima de um arquivo: cai na pasta dele.
        </p>
        <p>
          Arrastar <strong>copia</strong>, nunca move, e <strong>nunca sobrescreve</strong>. Se a
          pasta já existir, ela é mesclada: só os arquivos novos entram, e o que já estava lá fica
          intocado. Então, quando o professor postar mais duas aulas, é só arrastar a matéria de
          novo.
        </p>
        <p className="ajuda-nota">
          Prefere criar na mão? Botão direito na árvore → <em>Nova pasta</em>.
        </p>
      </Passo>

      <Passo n={4} titulo="Escreva a sua anotação da aula">
        <p>
          <K>Ctrl</K> <K>N</K> cria uma nota. Ela vive em <strong>Notes</strong>, do seu jeito — não
          precisa ser bonita nem completa. O que o Athena aproveita é o que só você tem: o que o
          professor falou e não está no slide, o que caiu na prova, o que você não entendeu.
        </p>
      </Passo>

      <Passo n={5} titulo="Gere a página">
        <p>
          Vá em <strong>Comandos</strong> (<K>Ctrl</K> <K>Shift</K> <K>P</K>), escolha a matéria e a
          aula, e clique em <em>Gerar página</em>. O Athena lê o material oficial e a sua nota, e
          escreve o resumo.
        </p>
        <p>
          Um comando por vez; os outros entram na fila. O painel da direita mostra ao vivo o que
          está sendo feito — e é lá que aparece quando o assistente para para perguntar alguma
          coisa.
        </p>
      </Passo>

      <Passo n={6} titulo="Leia, e conserte se precisar">
        <p>
          A página aberta traz, na lateral, o <em>Material de origem</em>: o arquivo do professor
          que deu origem a ela, a um clique. Se a página não ficou boa, ou se você escreveu mais na
          sua nota depois, use <em>Regerar do zero</em> — ela é reescrita ignorando a versão atual.
        </p>
      </Passo>

      <Passo n={7} titulo="Teste o que aprendeu">
        <p>
          <em>Gerar questões</em> monta um exercício de fixação a partir da página. Depois,{" "}
          <em>Abrir review</em> abre o que foi gerado.
        </p>
      </Passo>

      <Passo n={8} titulo="Publique">
        <p>
          Publicar manda suas anotações, as páginas e o material para a sua conta na nuvem. É o que
          faz o conteúdo existir fora deste computador — e é o que permite abrir o app noutra
          máquina e encontrar tudo no lugar.
        </p>
      </Passo>

      <Passo n={9} titulo="Apagar, e o que isso significa">
        <p>
          <K>Del</K> no item selecionado, ou botão direito → <em>Apagar</em>. O arquivo vai para a
          lixeira do Windows, dá para restaurar.
        </p>
        <p>
          Se ele também estiver na nuvem, o aviso oferece tirar de lá junto — e essa parte{" "}
          <strong>é definitiva</strong>: a nuvem não guarda versão anterior. Se você apagar só desta
          máquina, o arquivo volta a aparecer com ícone de nuvem e desce de novo no próximo clique.
        </p>
      </Passo>

      <Passo n={10} titulo="Onde ficam os seus arquivos">
        <p>
          O app cuida da pasta sozinho — você não precisa escolher nem saber onde ela fica. Se
          quiser ver, vá em <strong>Configurações → Seus arquivos</strong>: dá para abrir no
          Explorer, baixar da conta o que estiver faltando, exportar tudo, ou apontar para outra
          pasta.
        </p>
      </Passo>

      <section className="ajuda-atalhos">
        <h2>Atalhos que valem a pena decorar</h2>
        <ul>
          <li>
            <K>Ctrl</K> <K>P</K> abrir uma página
          </li>
          <li>
            <K>Ctrl</K> <K>K</K> buscar em tudo, inclusive dentro dos arquivos
          </li>
          <li>
            <K>Ctrl</K> <K>Shift</K> <K>P</K> ir para os Comandos
          </li>
          <li>
            <K>Ctrl</K> <K>N</K> nova nota
          </li>
          <li>
            <K>Ctrl</K> <K>W</K> fechar a aba
          </li>
          <li>
            <K>F2</K> renomear · <K>Del</K> apagar · <K>Esc</K> fechar o que está por cima
          </li>
        </ul>
      </section>

      <footer className="ajuda-fim">
        <p>
          Travou em alguma coisa? A lista completa de atalhos e os ajustes do app estão em
          Configurações. Esta janela pode ficar aberta ao lado enquanto você usa o Athena.
        </p>
      </footer>
    </div>
  );
}
