import { google } from "@ai-sdk/google"
import { generateText } from "ai"
import TelegramBot from "node-telegram-bot-api"
import { generateAnswerInstruction, processInstruction } from "./instruction"
import axios from "axios"

const normalizeOdds = (value: any): number => {
  if (value == null) return 0
  const num = typeof value === "string" ? parseFloat(value) : value
  if (isNaN(num)) return 0
  if (num > 1) return Math.min(num / 100, 1)
  return Math.max(Math.min(num, 1), 0)
}

class Bot {
  private bot: TelegramBot

  constructor(token: string) {
    this.bot = new TelegramBot(token)
    this.bot.on("message", this.onMessage)
  }

  askAi = async (instruction: string): Promise<string> => {
    const { text } = await generateText({
      model: google("gemini-2.0-flash-lite"),
      prompt: instruction,
    });

    return text
  }

  queryPolymarket = async (keywords: string): Promise<any> => {
    try {
      const { data } = await axios.get(
        `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(keywords)}&events_status=active`
      )

      const events = data?.events || []
      const results: {
        question: string
        description: string
        yesProbability: number
        noProbability: number
        liquidity: number
      }[] = []

      for (const event of events) {
        const markets = event?.markets || []
        for (const market of markets) {
          let outcomePrices: number[] = []
          try {
            if (typeof market.outcomePrices === "string") {
              outcomePrices = JSON.parse(market.outcomePrices).map((v: string) =>
                parseFloat(v)
              )
            } else if (Array.isArray(market.outcomePrices)) {
              outcomePrices = market.outcomePrices.map((v: any) => parseFloat(v))
            }
          } catch (e) {
            outcomePrices = []
          }

          const yesPriceRaw = outcomePrices[0] ?? null
          const noPriceRaw = outcomePrices[1] ?? null

          const yesProbability = normalizeOdds(yesPriceRaw)
          const noProbability = normalizeOdds(noPriceRaw)

          if (yesProbability === 0 || noProbability === 0) continue

          results.push({
            question: market.question,
            description: market.description || "",
            yesProbability,
            noProbability,
            liquidity: market.liquidity ?? 0,
          })
        }
      }
      return results.slice(0, 4) // Trả về tối đa 3 kết quả hàng đầu
    } catch (error) {
      console.error("❌ Error fetching Polymarket data:", error)
      return []
    }
  }

  onMessage = async (msg: any) => {
    let question = msg.text?.trim()
    if (!question) return

    const chatType = msg.chat?.type // 'private', 'group', 'supergroup'
    const botUsername = (await this.bot.getMe()).username // ví dụ: "LucciBot"

    // 🔹 Nếu là group, chỉ phản hồi khi được mention
    if (chatType !== "private") {
      const isMentioned =
        question.includes(`@${botUsername}`)

      if (!isMentioned) return // ⛔ Bỏ qua tin nhắn không tag bot
      question = question.replace(new RegExp(`@${botUsername}`, "gi"), "").trim()
    }

    const odds = await this.queryPolymarket(question)

    const answers = odds.map((item: any) => {
      return `❓ Question: ${item.question}
✅ Yes Probability: ${(item.yesProbability * 100).toFixed(2)}%
❌ No Probability: ${(item.noProbability * 100).toFixed(2)}%`
    }).join("\n\n")

    if (answers.length === 0) {
      await this.bot.sendMessage(msg.chat.id, "❌ No relevant markets found on Polymarket.")
      return
    }

    await this.bot.sendMessage(msg.chat.id, answers)
  }

  start = async () => {
    console.log("🤖 Bot is starting...")
    this.bot.startPolling()
  }

  test = async () => {
    const keywords = "elon must tweet 220-239"

    const odds = await this.queryPolymarket(keywords)
    console.log("📊 Polymarket Odds:", odds)
  }
}

const main = async () => {
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || "")
  await bot.start()
  // await bot.test()
}

main()
