// ════════════════════════════════════════════════════════
// api/tools.ts —— function calling 工具注册：5 个动作各一个 tool（从 assistant.ts 拆出）
// ════════════════════════════════════════════════════════
// 模型「选工具」代替「写 action 字段」。parameters 是 JSON Schema，
// 模型产出的 arguments 由 API 协议保证为合法 JSON——替代手写 tryExtractJSON（截断/嵌套/转义不再怕）。
// 行为规则（追问范围、否定查询、组合约束、能力边界）仍写在 prompt 里（prompt.ts），Schema 只负责形状。
import type { ChatTool } from './client'
import { VALID_OPS } from './operateMeta'

export const ASSISTANT_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'search',
      description: '用户想找代码片段。ids 是符合要求的片段编号（按相关度从高到低排列）；用户明确说了要几个就输出几个；一个都不符合时输出空数组。note 可一句话说明筛选依据。',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'integer' }, description: '符合要求的片段编号 1..N' },
          note: { type: 'string', description: '可选：一句话说明筛选依据，如「代码最短的前 2 条」' }
        },
        required: ['ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'summarize',
      description: '用户想让你总结/讲解/对比分析选中的片段。ids 是被分析的编号，text 是中文分析（可用 markdown）。',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'integer' }, description: '被分析的片段编号：用户说了几个就几个，没说明确个数挑最相关的 1-2 个，总结整个库这类无具体指代时给空数组' },
          text: { type: 'string', description: '中文分析，可用 markdown（分点、加粗），要结合代码讲具体，不要空泛' }
        },
        required: ['ids', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'operate',
      description: '用户想做库操作（删除/重命名/导出/收藏/取消收藏/新建/清空/收藏夹管理/改描述或语言/修改代码）。只能提议，绝不直接执行，实际写入由用户确认后前端完成。修改代码是 op:"modify"（ids=目标编号、value=修改需求，必须说清怎么改，空泛"优化一下"不算有效需求）；用户没说改哪个、或只说"帮我改下/优化一下"没说清改成什么样 → 改用 ask 澄清，不要调本工具。一条指令做多件事时用 ops 数组列出所有步骤（仅限可逆操作：收藏/取消收藏/导出/新建夹/改名/移动/改描述语言；不含修改代码与新建代码）。',
      parameters: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: VALID_OPS, description: '操作类型（单操作时用；用 ops 时忽略）' },
          ops: {
            type: 'array',
            description: '复合操作：一次要求做多件事（如「新建收藏夹并把第 1 个放进去」）时按顺序列出所有步骤；每个步骤 op/ids/value/target/field 与单操作同义；只限可逆操作，不要包含删除/清空/新建代码/修改代码',
            items: {
              type: 'object',
              properties: {
                op: { type: 'string', enum: VALID_OPS, description: '操作类型' },
                ids: { type: 'array', items: { type: 'integer' }, description: '目标片段编号（delete/favorite/unfavorite 支持多个；新建收藏夹并放入片段时，收藏那步写要放入的编号）' },
                value: { type: 'string', description: 'rename 的新标题 / favorite、unfavorite 的收藏夹名 / 各 folder 操作的夹名 / meta 的新值' },
                target: { type: 'string', description: 'renameFolder 的旧夹名（从「当前收藏夹」里选）' },
                field: { type: 'string', enum: ['description', 'language'], description: 'meta 的目标字段' }
              },
              required: ['op']
            }
          },
          ids: { type: 'array', items: { type: 'integer' }, description: '目标片段编号（delete/favorite/unfavorite/modify 支持多个；create/clear 不需要；新建收藏夹并放入片段时，用 ops 里第二步 favorite 的 ids）' },
          value: { type: 'string', description: 'rename 的新标题 / favorite、unfavorite 的收藏夹名 / create 的标题或需求 / 各 folder 操作的夹名 / meta 的新值 / modify 的修改需求' },
          target: { type: 'string', description: 'renameFolder 的旧夹名（从「当前收藏夹」里选）' },
          field: { type: 'string', enum: ['description', 'language'], description: 'meta 的目标字段' },
          language: { type: 'string', description: 'create 的代码语言' },
          note: { type: 'string', description: '可选：操作提醒（删除/清空等不可逆操作提醒「请确认」）' }
        },
        required: ['op']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask',
      description: '用户想找片段但意图模糊（只说了"你好""随便看看"），用一句话向用户确认要找什么。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '确认要找什么的一句话提问' }
        },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'chat',
      description: '与找片段无关（寒暄、闲聊、天气等），简短中文回复。',
      parameters: {
        type: 'object',
        properties: {
          reply: { type: 'string', description: '简短中文回复' }
        },
        required: ['reply']
      }
    }
  }
]
