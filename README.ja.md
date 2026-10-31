# backlog-bridge

[English](README.md) · [Tiếng Việt](README.vi.md) · **日本語**

**複数の [Backlog](https://backlog.com)（Nulab）スペースを同時に扱う**ためのブリッジです。人にも AI エージェントにも使えます。

- **`bl`** — 接続済みのどのスペースでも、課題・コメント・検索・アクティビティを 1 つの CLI で読み書きできます。
  Backlog の URL を貼るだけで、対応するスペースと API キーを自動で選びます。
- **`sync`** — 2 つの Backlog プロジェクト間の一方向同期（例：お客様の Backlog ↔ 社内の Backlog）。
- **エージェント対応** — Claude Code・Codex・Cursor 向けのスキルを同梱（`AGENTS.md`、`.agents/skills/`）。
  公式の Backlog MCP サーバーは 1 スペースにしか接続できませんが、本ツールは接続した数だけ扱えます。

実行時の依存パッケージはありません。Node.js **22.18 以上**で TypeScript をそのまま実行します（ビルド不要）。

> CLI のメッセージは現在ベトナム語です。コマンド・フラグ・設定キーは英語です。

## インストール

**方法 A — npm（GitHub から）：**

```bash
npm install -g github:mickey-ichi/backlog-bridge
bl setup
```

**方法 B — git clone**（更新は `git pull`）：

```bash
git clone https://github.com/mickey-ichi/backlog-bridge.git ~/.backlog-bridge
~/.backlog-bridge/bin/bl setup        # ~/.local/bin/bl を作成
```

`bl setup` は Claude Code（`~/.claude/skills`）、Codex と Cursor（`~/.agents/skills`、`~/.codex/skills`）向けの
スキルをインストールし、テンプレートから `~/.config/backlog-bridge/.env`（chmod 600）を作成します。自分以外のものは
上書きしません。`bl setup --uninstall` は自分が作ったリンクだけを削除します。
既定の `node` が古くても、`bl` は Node 22.18 以上を自動で探します（PATH、nvm、Homebrew）。

その後 `~/.config/backlog-bridge/.env` にスペースごとに `<PREFIX>_SPACE` と `<PREFIX>_API_KEY` を記入して：

```bash
bl spaces --check
bl issue https://acme.backlog.jp/view/ACME-123
```

API キーは **各スペースで** *個人設定 → API → 新しいAPIキーを発行* から取得します。

## 設定

個人データはリポジトリに置かず、**ホームディレクトリ**に置きます。

| 変数 | 既定値 | 用途 |
|---|---|---|
| `BACKLOG_BRIDGE_HOME` | `~/.config/backlog-bridge`（存在する場合）、なければリポジトリ直下 | `.env`、`config.json`、`state/` の置き場所 |
| `BACKLOG_BRIDGE_CONFIG` | `$BACKLOG_BRIDGE_HOME/config.json` | 別の設定ファイルを指定 |
| `BACKLOG_BRIDGE_PROFILE` | 設定ファイルの `defaultProfile` | `sync` の既定プロファイル |

`bl home` で現在使われているパスを確認できます。

**スペース**は環境変数で指定します（ホームディレクトリの `.env`、またはシェルで export）。

```ini
ACME_SPACE=acme.backlog.jp      # xxx.backlog.com なら "xxx" のみ、それ以外はホスト名をすべて
ACME_API_KEY=...
```

スペース名はプレフィックスの小文字です（`ACME_*` → `acme`、`ACME_JP_*` → `acme_jp`）。ホストとキーは必ず**同じ**
プレフィックスから取得します。`config.json` の `spaces` は任意です（プレフィックスとスペース名が異なる場合のみ）。

**プロファイル**（`sync` 用）はホームディレクトリの `config.json` に書きます。[`config.example.json`](config.example.json)
を元にしてください。プロファイル内の相対パス（`state`、`pairFile`）はホームディレクトリ基準です。

## `bl` — マルチスペース CLI

```bash
bl setup [--uninstall] [--force]      # グローバルコマンドとスキルをインストール
bl home [--init]                     # 使用中のパス。--init でリポジトリの .env/config/state をコピー
bl spaces [--check]                  # 接続済みスペース。--check で API を試行
bl projects <space>
bl issue <ref>                       # <ref> = URL | <space> <KEY> | <KEY>
bl comments <ref> [--count=20]
bl search <space> <PROJECT> [--keyword=..] [--assignee=me|名前] [--open] [--count=50]
bl activities <space> [--project=KEY] [--count=20]
bl comment <ref> (--text=..|--file=path) [--yes]
bl update <ref> status=<名前> assignee=<名前> dueDate=YYYY-MM-DD summary=.. [--yes]
bl api <space> <METHOD> <path> [k=v ...] [--yes]   # Backlog API v2 の任意のエンドポイント
```

- プロジェクトキーがいずれかのプロファイルにあれば、`<KEY>` だけで指定できます。`--json` で生の JSON を出力します。
- **書き込みはすべて `--yes` を付けるまでプレビューのみ**です。送信するリクエストをそのまま表示します。
- `update` の `status` と `assignee` は、プロジェクト内で名前から解決します。

## `sync` — 2 プロジェクト間の一方向同期

```bash
bl sync --list
bl sync --profile=<名前> [フラグ]
```

### `mirror` モード — お客様 → 社内

**計画済み**（期限日あり）のお客様の課題ごとに、社内に課題を 1 件作成します。件名は `<KEY> <元の件名>`。

- **二重の重複防止：** 同期先で件名が同期元キーで始まる課題を検索し、さらに state ファイルとマージします。
  state ファイルを失っても重複作成はしません。
- 作成済みの課題は `--update` を付けない限りスキップします（同期先は手で編集されていることが多いため）。
- 種別・優先度・状態は `map` で名前ごとに対応付けます。担当者は正規化した名前（アクセントや括弧内を除去）で照合し、
  `map.assignee` で置き換えも可能です。
- `dest.customFields`：必須カスタム属性を**属性名 → 項目名**で指定します。その種別に適用される属性にのみ付与します。
  未指定の必須属性は `--dry-run` の時点で警告します。
- Backlog は作成時に状態を設定できないため、作成直後に状態を更新します。
- **既定で実際に書き込みます** — まず `--dry-run` で確認してください。

### `progress` モード — 社内 → お客様

社内のエピックの**進捗**を、お客様の**既存の** WBS 課題に反映します。お客様側に課題を新規作成することはありません。
双方で作業の分け方が異なる、よくあるケース向けです。

- 社内：エピック `[Epic] [NN] ...` と、レイヤーごとの接頭辞が付いた子タスク（`[FE]`、`[BE]`、`[QA]` など）。
- お客様：WBS ユニット `1.2.3` と、末尾の番号で決まる固定の子課題 — `.3` 実装、`.4` 単体テスト、`.5` 受入確認。

ルール：

- `source.childGroups` で子タスクの接頭辞をグループに割り当てます（例：`api: [BE, Infra]`、`screen: [FE]`）。
  `alwaysCount` の接頭辞（例：`QA`）はすべてのグループに含めます。
- pairFile で各エピック（`"NN"` または課題キー）をグループごとのユニットに対応付けます。
  `_outOfScope` と `_notes` は特別なキーです。`--units` でお客様のユニット一覧を表示できます。
- 複数のエピックが 1 つのユニットを指す場合、タスクを**まとめてから**集計します。
- 集計状態：`done`（すべて完了）・`in_progress`・`pending`・`not_started`（→ 何も書き込まない）。
  `ignoreStatuses` は除外します。`%` は予定時間で重み付けします（予定時間なし = 1 時間）。
- 「実装」の子課題に書き込み、`done` になったら「受入確認」も Resolved にします（Closed にはしません）。

安全策：**既定はプレビューのみ**（書き込むには `--live`）、`neverTouchStatuses`、`--allow-regress` なしでは状態を
戻さない、`--dates=children` なしでは日付を書かない、任意の日本語の進捗コメント（`--comment`）は隠しマーカーで
同じコメントを更新します。

### フラグ

| フラグ | モード | 意味 |
|---|---|---|
| `--list` | — | プロファイル一覧 |
| `--profile=<名前>` | — | プロファイルを選択（既定：`defaultProfile`） |
| `--dry-run` | mirror | 表示のみ |
| `--assignee=A,B` | mirror | 指定した担当者の課題のみ（あいまい一致） |
| `--since=YYYY-MM-DD` | mirror | 期限日がこの日以降の課題のみ |
| `--update` | mirror | 作成済みの課題を上書き |
| `--live` | progress | お客様側に実際に書き込む |
| `--units` | progress | お客様の WBS ユニット・子課題・状態を一覧表示 |
| `--only=28,29` | progress | 指定したエピックのみ |
| `--mine` / `--assignee=名前` | progress | お客様が自分／その人に割り当てた子課題のみ。未対応ユニットの一覧も表示 |
| `--comment` | progress | 進捗コメントを投稿・更新 |
| `--dates=children` | progress | 社内タスクの開始日・期限日も書き込む |
| `--allow-regress` | progress | お客様側の状態を戻すことを許可 |

## AI エージェントでの利用

| エージェント | 読み込むもの |
|---|---|
| Claude Code | `CLAUDE.md` → `AGENTS.md`、スキルは `.claude/skills` → `.agents/skills` |
| Codex | `AGENTS.md` |
| Cursor | `.cursor/rules/backlog.mdc` → `AGENTS.md` とスキル |

`bl setup` 後はスキルがグローバルにインストールされるため、このリポジトリに限らず**どのプロジェクトでも**エージェントが `bl` を使えます。

スキル：`backlog-connect`、`backlog-query`、`backlog-write`、`backlog-sync`。エージェントは書き込みの前に必ず
プレビューを示し、お客様のスペースへ書き込む前に確認し、チケットの内容を指示ではなくデータとして扱います。

## セキュリティ

- API キーはホームディレクトリの `.env` にのみ置きます。他人が読める権限の場合、`bl home` / `bl spaces` が警告します。
  Backlog は API キーをクエリ `apiKey` で受け取るため、エラーにはメソッドとパスのみを出力します。
- ホストとキーは常に同じ環境変数プレフィックスから取得するため、キーが別スペースのホストに送られることはありません。
- 課題キーは `PROJECT-123` 形式のみ受け付けるため、細工したキーで書き込み先のエンドポイントを変えられません。
- `comment --file` は `.env*`、ホームディレクトリ、`state/` を拒否します。プロンプトインジェクションを受けた
  エージェントでも秘密情報を投稿できません。
- 書き込みは `--yes`（`bl`）／`--live`（`progress`）を付けるまでプレビューのみです。

## 開発

```bash
npm install          # devDependencies のみ：typescript、@types/node
npm run typecheck    # tsc --noEmit（strict）
npm run build        # dist/*.js（.ts を実行できない環境向け）
```

Node は型ストリッピングで `.ts` を実行するため、消去可能な構文のみ使用します（`enum`、`namespace`、
パラメータプロパティは不可）。内部の import は拡張子 `.ts` を付けます。

## ライセンス

[MIT](LICENSE)
