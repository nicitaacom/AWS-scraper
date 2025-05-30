export const extractEmailSafely = async (url: string): Promise<string> => {
  try {
    // 🌐 Normalize URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url

    // ⏳ Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Email extraction timeout')), 4000))

    // 🧠 Fetch + timeout race
    const res = await Promise.race([
      fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadBot/1.0)" } }), // removed invalid timeout key
      timeoutPromise
    ])

    // ❌ Check if response is bad
    if (!res.ok) return ""

    // 🕵️‍♂️ Extract email
    const html = await res.text()
    const emails = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}/g)
    return emails?.find(email => !/(example|test|placeholder|noreply|no-reply|admin|info@example)/.test(email.toLowerCase()) && email.length < 50) || ""
  } catch {
    return ""
  }
}
