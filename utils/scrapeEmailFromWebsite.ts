import fetch from "node-fetch"

/**
 * Scrape email addresses from a website
 * Uses native JavaScript DOM parsing instead of cheerio
 */
export async function scrapeEmailFromWebsite(website: string): Promise<string> {
  try {
    // Clean up the URL
    let url = website.trim()
    if (!url.startsWith('http')) {
      url = 'https://' + url
    }
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    })
    
    if (!response.ok) return ""
    
    const html = await response.text()
    
    // Remove script and style tags using regex
    const cleanHtml = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ') // Remove all HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
    
    // Email regex patterns
    const emailPatterns = [
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/gi
    ]
    
    const foundEmails = new Set<string>()
    
    for (const pattern of emailPatterns) {
      const matches = cleanHtml.match(pattern)
      if (matches) {
        matches.forEach(email => {
          const cleanEmail = email.replace('mailto:', '').toLowerCase()
          foundEmails.add(cleanEmail)
        })
      }
    }
    
    // Filter out common non-business emails and find the best one
    const businessEmails = Array.from(foundEmails).filter(email => {
      return !email.includes('noreply') &&
             !email.includes('no-reply') &&
             !email.includes('donotreply') &&
             !email.includes('example.com') &&
             !email.includes('test.com') &&
             !email.includes('placeholder') &&
             !email.includes('sample.com') &&
             !email.includes('yoursite.com')
    })
    
    // Prioritize contact/info/hello emails, then any business email
    const priorityEmails = businessEmails.filter(email => 
      email.includes('contact') || 
      email.includes('info') || 
      email.includes('hello') ||
      email.includes('support')
    )
    
    return priorityEmails[0] || businessEmails[0] || ""
    
  } catch (error) {
    console.error("Email scraping failed for", website, error)
    return ""
  }
}