import fetch from "node-fetch"

export async function scrapeContactsFromWebsite(website: string): Promise<{ email: string; phone: string }> {
  try {
    let url = website.trim()
    if (!url.startsWith("http")) url = "https://" + url

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      timeout: 10000
    })

    if (!response.ok) return { email: "", phone: "" }

    const html = await response.text()

    const cleanHtml = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")

    const foundEmails = new Set<string>()
    const foundPhones = new Set<string>()

    // 📧 Email regex patterns
    const emailPatterns = [
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/gi
    ]

    // 📞 Phone number pattern (international & local formats)
    const phonePattern = /(?:\+?\d{1,4}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/g

    // Extract emails
    for (const pattern of emailPatterns) {
      const matches = cleanHtml.match(pattern)
      if (matches) {
        matches.forEach(email => {
          const cleanEmail = email.replace("mailto:", "").toLowerCase()
          foundEmails.add(cleanEmail)
        })
      }
    }

    // Extract phones
    const phoneMatches = cleanHtml.match(phonePattern)
    if (phoneMatches) {
      phoneMatches.forEach(phone => {
        const cleaned = phone.trim()
        if (cleaned.length >= 8 && cleaned.length <= 18) foundPhones.add(cleaned)
      })
    }

    // 🚫 Filter out generic emails
    const businessEmails = Array.from(foundEmails).filter(
      email =>
        !email.includes("noreply") &&
        !email.includes("no-reply") &&
        !email.includes("donotreply") &&
        !email.includes("example.com") &&
        !email.includes("test.com") &&
        !email.includes("placeholder") &&
        !email.includes("sample.com") &&
        !email.includes("yoursite.com")
    )

    // ⭐ Prioritize contact/info/support emails
    const priorityEmails = businessEmails.filter(
      email => email.includes("contact") || email.includes("info") || email.includes("hello") || email.includes("support")
    )

    return {
      email: priorityEmails[0] || businessEmails[0] || "",
      phone: Array.from(foundPhones)[0] || ""
    }
  } catch (error) {
    console.error("Contact scraping failed for", website, error)
    return { email: "", phone: "" }
  }
}
