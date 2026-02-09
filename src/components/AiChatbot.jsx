import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from '../firebase';
import dayjs from 'dayjs';
import axios from 'axios';

function AiChatbot() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Gathering global intelligence data...");

  // ⚠️ Load API key from environment variables (.env file: REACT_APP_OPENAI_API_KEY)
  const API_KEY = process.env.REACT_APP_OPENAI_API_KEY || "";

  // News API (optional) - get free key from newsapi.org
  const NEWS_API_KEY = process.env.REACT_APP_NEWS_API_KEY || "";

  const messagesEndRef = useRef(null);
  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  useEffect(scrollToBottom, [messages]);

  // ========================================
  // External Data Collection Functions
  // ========================================

  // 1. Exchange Rate Data (Free API - no key required)
  const fetchExchangeRates = async () => {
    try {
      const response = await axios.get('https://api.exchangerate-api.com/v4/latest/JPY');
      const rates = response.data.rates;
      return {
        USD_JPY: (1 / rates.USD).toFixed(2),
        KRW_JPY: (1 / rates.KRW).toFixed(4),
        CNY_JPY: (1 / rates.CNY).toFixed(3),
        TWD_JPY: (1 / rates.TWD).toFixed(3),
        EUR_JPY: (1 / rates.EUR).toFixed(2),
        updated: response.data.date
      };
    } catch (err) {
      console.error("Exchange rate API error:", err);
      return null;
    }
  };

  // 2. Weather Data (Open-Meteo - free, no key required!)
  const fetchWeather = async () => {
    try {
      // Shinjuku coordinates
      const lat = 35.6938;
      const lon = 139.7034;
      const response = await axios.get(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia/Tokyo&forecast_days=7`
      );

      const weatherCodeToText = (code) => {
        const codes = {
          0: "Clear ☀️", 1: "Mainly Clear 🌤️", 2: "Partly Cloudy ⛅", 3: "Overcast ☁️",
          45: "Fog 🌫️", 48: "Fog 🌫️",
          60: "Light Drizzle 🌧️", 53: "Drizzle 🌧️", 55: "Drizzle 🌧️",
          61: "Light Rain 🌧️", 63: "Rain 🌧️", 65: "Heavy Rain 🌧️",
          71: "Light Snow 🌨️", 73: "Snow 🌨️", 75: "Heavy Snow 🌨️",
          80: "Rain Showers 🌧️", 81: "Rain Showers 🌧️", 82: "Heavy Showers 🌧️",
          95: "Thunderstorm ⛈️", 96: "Thunderstorm with Hail ⛈️", 99: "Thunderstorm with Hail ⛈️"
        };
        return codes[code] || "Unknown";
      };

      const current = response.data.current;
      const daily = response.data.daily;

      const forecast = daily.time.slice(0, 7).map((date, i) => ({
        date: dayjs(date).format('MM/DD (ddd)'),
        tempMax: Math.round(daily.temperature_2m_max[i]),
        tempMin: Math.round(daily.temperature_2m_min[i]),
        weather: weatherCodeToText(daily.weather_code[i])
      }));

      return {
        current: {
          temp: Math.round(current.temperature_2m),
          weather: weatherCodeToText(current.weather_code),
          humidity: current.relative_humidity_2m
        },
        forecast,
        note: null
      };
    } catch (err) {
      console.error("Weather API error:", err);
      return null;
    }
  };

  // 3. News Data (NewsAPI)
  const fetchNews = async () => {
    if (!NEWS_API_KEY || NEWS_API_KEY === "YOUR_NEWS_API_KEY") {
      // Fallback data when no API key (based on latest trends)
      return {
        articles: [
          { title: "Japan inbound tourism recovers to pre-COVID levels", source: "Trend Info" },
          { title: "Weak yen boosts Asian tourist arrivals", source: "Trend Info" },
          { title: "Shinjuku Golden Gai becomes popular foreign tourist spot", source: "Trend Info" }
        ],
        note: "Set up NewsAPI key to get real-time news"
      };
    }
    try {
      const response = await axios.get(
        `https://newsapi.org/v2/everything?q=Japan tourism OR inbound&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`
      );
      return {
        articles: response.data.articles.map(a => ({
          title: a.title,
          source: a.source.name,
          url: a.url,
          publishedAt: a.publishedAt
        })),
        note: null
      };
    } catch (err) {
      console.error("News API error:", err);
      return null;
    }
  };

  // 4. Japan Events/Festivals Data (Custom DB)
  const getUpcomingEvents = () => {
    const today = dayjs();

    // Tokyo/Shinjuku major events database
    const events = [
      // Annual fixed events
      { name: "New Year Holiday", start: `${today.year()}-12-29`, end: `${today.year() + 1}-01-03`, impact: "very_high", type: "holiday", description: "Japan's biggest holiday, massive domestic/international travel surge" },
      { name: "New Year Holiday", start: `${today.year()}-01-01`, end: `${today.year()}-01-03`, impact: "very_high", type: "holiday", description: "Japan's biggest holiday" },
      { name: "Coming of Age Day", start: `${today.year()}-01-06`, end: `${today.year()}-01-08`, impact: "medium", type: "holiday", description: "3-day weekend" },
      { name: "Valentine's Day", start: `${today.year()}-02-14`, end: `${today.year()}-02-14`, impact: "low", type: "event", description: "Slight increase in couple travel" },
      { name: "Golden Week", start: `${today.year()}-04-29`, end: `${today.year()}-05-05`, impact: "very_high", type: "holiday", description: "Major Japan holiday, booking surge" },
      { name: "Tanabata (Star Festival)", start: `${today.year()}-07-07`, end: `${today.year()}-07-07`, impact: "low", type: "festival", description: "Festivals across Tokyo" },
      { name: "Obon Holiday", start: `${today.year()}-08-11`, end: `${today.year()}-08-16`, impact: "very_high", type: "holiday", description: "Summer major holiday" },
      { name: "Halloween", start: `${today.year()}-10-28`, end: `${today.year()}-10-31`, impact: "high", type: "event", description: "Shibuya/Shinjuku costume crowds" },
      { name: "Christmas", start: `${today.year()}-12-23`, end: `${today.year()}-12-25`, impact: "high", type: "holiday", description: "Couple/family travel increase" },

      // Regular events
      { name: "Comiket C103 (Winter)", start: `${today.year()}-12-28`, end: `${today.year()}-12-31`, impact: "high", type: "event", description: "Big Sight, otaku customer surge" },
      { name: "Comiket C104 (Summer)", start: `${today.year()}-08-10`, end: `${today.year()}-08-13`, impact: "high", type: "event", description: "Big Sight, otaku customer surge" },

      // Shinjuku area events
      { name: "Shinjuku Eisa Festival", start: `${today.year()}-07-27`, end: `${today.year()}-07-27`, impact: "medium", type: "festival", description: "Shinjuku street Okinawan festival" },
      { name: "Tokyo Marathon", start: `${today.year()}-03-03`, end: `${today.year()}-03-03`, impact: "medium", type: "event", description: "Starts in Shinjuku, runner accommodation demand" },

      // Cherry blossom/autumn foliage seasons
      { name: "Cherry Blossom Season", start: `${today.year()}-03-20`, end: `${today.year()}-04-10`, impact: "very_high", type: "season", description: "Shinjuku Gyoen cherry blossoms, peak season" },
      { name: "Autumn Foliage Season", start: `${today.year()}-11-15`, end: `${today.year()}-12-05`, impact: "high", type: "season", description: "Fall tourism peak season" },
    ];

    // Filter events within next 30 days
    const upcoming = events.filter(event => {
      const start = dayjs(event.start);
      const end = dayjs(event.end);
      const daysUntilStart = start.diff(today, 'day');
      const daysUntilEnd = end.diff(today, 'day');

      // Ongoing or starting within 30 days
      return (daysUntilEnd >= 0 && daysUntilStart <= 30);
    }).map(event => {
      const start = dayjs(event.start);
      const daysUntil = start.diff(today, 'day');
      return {
        ...event,
        daysUntil: daysUntil < 0 ? 0 : daysUntil,
        status: daysUntil <= 0 ? "Ongoing" : `In ${daysUntil} days`
      };
    }).sort((a, b) => a.daysUntil - b.daysUntil);

    return upcoming;
  };

  // 5. Inbound Statistics (based on JNTO public data)
  const getInboundStats = () => {
    // Based on JNTO latest public data (needs monthly update)
    const monthlyTrends = {
      1: { total: 2800000, kr: 28, cn: 25, tw: 15, us: 8, trend: "Normal" },
      2: { total: 2600000, kr: 27, cn: 26, tw: 14, us: 8, trend: "Low Season" },
      3: { total: 3100000, kr: 26, cn: 24, tw: 15, us: 9, trend: "Cherry Blossom Start" },
      4: { total: 3500000, kr: 25, cn: 23, tw: 16, us: 10, trend: "Cherry Blossom Peak" },
      5: { total: 3200000, kr: 26, cn: 24, tw: 15, us: 9, trend: "Golden Week" },
      6: { total: 2900000, kr: 27, cn: 25, tw: 14, us: 8, trend: "Rainy Season" },
      7: { total: 3300000, kr: 28, cn: 24, tw: 15, us: 9, trend: "Summer Vacation" },
      8: { total: 3400000, kr: 29, cn: 23, tw: 16, us: 9, trend: "Obon" },
      9: { total: 2800000, kr: 28, cn: 24, tw: 15, us: 8, trend: "Low Season" },
      10: { total: 3200000, kr: 27, cn: 25, tw: 15, us: 9, trend: "Foliage Start" },
      11: { total: 3400000, kr: 26, cn: 26, tw: 16, us: 9, trend: "Foliage Peak" },
      12: { total: 3600000, kr: 28, cn: 25, tw: 15, us: 10, trend: "Year End" }
    };

    const currentMonth = dayjs().month() + 1;
    const data = monthlyTrends[currentMonth];

    return {
      estimatedMonthly: data.total,
      topCountries: [
        { country: "South Korea", percentage: data.kr, flag: "🇰🇷" },
        { country: "China", percentage: data.cn, flag: "🇨🇳" },
        { country: "Taiwan", percentage: data.tw, flag: "🇹🇼" },
        { country: "USA", percentage: data.us, flag: "🇺🇸" }
      ],
      trend: data.trend,
      source: "Based on JNTO statistics"
    };
  };

  // ========================================
  // Main Briefing Generation
  // ========================================
  useEffect(() => {
    const generateMegaBriefing = async () => {
      const todayStr = dayjs().format('YYYY-MM-DD');
      const cachedBriefing = sessionStorage.getItem('haru_ultimate_briefing');
      const cachedDate = sessionStorage.getItem('haru_briefing_date');

      if (cachedBriefing && cachedDate === todayStr) {
        setMessages([{ role: 'assistant', text: cachedBriefing }]);
        return;
      }

      setLoading(true);

      try {
        // Step 1: Collect internal data
        setStatusMsg("📊 Analyzing internal booking data...");
        const q = query(collection(db, "reservations"), where("status", "==", "confirmed"));
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => doc.data());

        const getStats = (mStr) => {
          const list = data.filter(r => r.arrival && r.arrival.startsWith(mStr));
          const rev = list.reduce((s, r) => s + (Number(r.price || r.totalPrice) || 0), 0);
          const nations = list.reduce((acc, r) => {
            const n = r.nationality || 'Unknown';
            acc[n] = (acc[n] || 0) + 1;
            return acc;
          }, {});
          return { rev, count: list.length, adr: list.length > 0 ? (rev / list.length).toFixed(0) : 0, nations };
        };

        const internalStats = {
          last: getStats(dayjs().subtract(1, 'month').format('YYYY-MM')),
          current: getStats(dayjs().format('YYYY-MM')),
          future: getStats(dayjs().add(1, 'month').format('YYYY-MM'))
        };

        // Step 2: Collect external data (parallel)
        setStatusMsg("🌐 Gathering global economic/tourism data...");
        const [exchangeRates, weather, news] = await Promise.all([
          fetchExchangeRates(),
          fetchWeather(),
          fetchNews()
        ]);

        // Event and inbound data
        const events = getUpcomingEvents();
        const inbound = getInboundStats();

        // Step 3: Generate AI briefing
        setStatusMsg("🤖 Generating AI analysis report...");

        const systemPrompt = `
You are the Chief Strategy Officer and dedicated business coach for Shinjuku 'HARU' guesthouse group.
Today's date: ${todayStr}
Location: Shinjuku, Tokyo

[Briefing Structure - Follow this order and format]

## 📊 Today's Key Insights
(Top 3 most important points in bullet format)

## 💱 Economic Environment Analysis
Exchange rate data: ${JSON.stringify(exchangeRates)}
- Impact of yen strength/weakness on customers from each country
- Which country to target for marketing

## 🌤️ Weather & Operations Suggestions
Weather data: ${JSON.stringify(weather)}
- Customer service tips based on weather
- What to prepare

## 📅 Upcoming Events
Event data: ${JSON.stringify(events)}
- Impact of each event on bookings
- What to prepare for

## ✈️ Inbound Tourism Trends
Inbound data: ${JSON.stringify(inbound)}
- Current season tourist trends
- Key customer demographics

## 📰 Tourism Industry News
News data: ${JSON.stringify(news)}
- Interpretation of news that may affect business

## 📈 Internal Performance Analysis
Internal data: ${JSON.stringify(internalStats)}
- Month-over-month change analysis
- Next month forecast

## 🎯 Today's Action Items
(3-5 specific actionable items)

[Writing Style]
- Use emojis appropriately for readability
- Explain technical terms in simple language
- Explain "why" with cause and effect
- Suggest with specific numbers
- Focus on actions that can be executed immediately
`;

        const response = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: "Please write today's comprehensive business intelligence briefing." }
          ],
          temperature: 0.6,
          max_tokens: 3000
        }, {
          headers: { Authorization: `Bearer ${API_KEY}` }
        });

        const briefingText = response.data.choices[0].message.content;
        sessionStorage.setItem('haru_ultimate_briefing', briefingText);
        sessionStorage.setItem('haru_briefing_date', todayStr);
        setMessages([{ role: 'assistant', text: briefingText }]);

      } catch (err) {
        console.error("Briefing generation error:", err);
        setMessages([{
          role: 'assistant',
          text: `❌ An error occurred while generating the briefing.\\n\\nError: ${err.message}\\n\\nPlease refresh or try again later.`
        }]);
      } finally {
        setLoading(false);
      }
    };

    generateMegaBriefing();
  }, []);

  // ========================================
  // Follow-up Conversation Handler
  // ========================================
  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input;
    const newMessages = [...messages, { role: 'user', text: userMsg }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      // Maintain system context
      const systemContext = `
You are HARU guesthouse's AI business assistant.
Answer the owner's follow-up questions kindly and in detail.
Provide specific advice based on data.
      `;

      const response = await axios.post("https://api.openai.com/v1/chat/completions", {
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemContext },
          ...newMessages.map(m => ({ role: m.role, content: m.text }))
        ],
        temperature: 0.7
      }, {
        headers: { Authorization: `Bearer ${API_KEY}` }
      });

      setMessages([...newMessages, { role: 'assistant', text: response.data.choices[0].message.content }]);
    } catch (err) {
      console.error("Conversation error:", err);
      setMessages([...newMessages, { role: 'assistant', text: `❌ Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  // Refresh briefing
  const handleRefresh = () => {
    sessionStorage.removeItem('haru_ultimate_briefing');
    sessionStorage.removeItem('haru_briefing_date');
    window.location.reload();
  };

  return (
    <div className="dashboard-content" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px',
        padding: '20px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        borderRadius: '16px',
        boxShadow: '0 10px 30px rgba(102, 126, 234, 0.2)'
      }}>
        <h2 style={{
          margin: 0,
          fontSize: '24px',
          fontWeight: '700',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span style={{ fontSize: '28px' }}>🌐</span>
          Haru Intelligence Center
        </h2>
        <button
          onClick={handleRefresh}
          style={{
            padding: '10px 20px',
            borderRadius: '10px',
            border: 'none',
            background: 'rgba(255, 255, 255, 0.2)',
            backdropFilter: 'blur(10px)',
            color: '#FFFFFF',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
        >
          🔄 Refresh Briefing
        </button>
      </div>

      {/* Chat Area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px',
        background: '#F8FAFC',
        borderRadius: '16px',
        marginBottom: '16px',
        border: '1px solid #E5E7EB'
      }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: '80px' }}>
            <div style={{
              fontSize: '64px',
              marginBottom: '24px',
              animation: 'pulse 2s infinite'
            }}>
              🌐
            </div>
            <p style={{
              color: '#64748B',
              fontSize: '16px',
              fontWeight: '600',
              marginBottom: '16px'
            }}>
              {statusMsg}
            </p>
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '12px',
              flexWrap: 'wrap',
              maxWidth: '500px',
              margin: '0 auto'
            }}>
              {['Exchange Rate', 'Weather', 'News', 'Events', 'Inbound'].map((item, i) => (
                <span key={i} style={{
                  padding: '8px 16px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  borderRadius: '20px',
                  fontSize: '13px',
                  fontWeight: '600',
                  color: '#FFFFFF',
                  boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
                }}>
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{
            textAlign: msg.role === 'user' ? 'right' : 'left',
            margin: '20px 0'
          }}>
            <div style={{
              display: 'inline-block',
              padding: '20px 24px',
              borderRadius: '16px',
              background: msg.role === 'user'
                ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                : '#FFFFFF',
              color: msg.role === 'user' ? '#FFFFFF' : '#1E293B',
              maxWidth: '90%',
              whiteSpace: 'pre-wrap',
              lineHeight: '1.8',
              boxShadow: msg.role === 'assistant'
                ? '0 4px 20px rgba(0,0,0,0.08)'
                : '0 4px 20px rgba(102, 126, 234, 0.3)',
              border: msg.role === 'assistant' ? '1px solid #E5E7EB' : 'none',
              fontSize: '15px',
              textAlign: 'left',
              fontWeight: msg.role === 'user' ? '500' : '400'
            }}>
              {msg.text}
            </div>
          </div>
        ))}

        {loading && messages.length > 0 && (
          <div style={{
            color: '#667eea',
            fontWeight: '600',
            textAlign: 'center',
            fontSize: '14px',
            padding: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}>
            <div style={{
              width: '20px',
              height: '20px',
              border: '3px solid #E5E7EB',
              borderTopColor: '#667eea',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }}></div>
            Analyzing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div style={{
        display: 'flex',
        gap: '12px',
        background: '#FFFFFF',
        padding: '16px',
        borderRadius: '16px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        border: '1px solid #E5E7EB'
      }}>
        <input
          className="form-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Ask more questions about strategy..."
          style={{
            flex: 1,
            marginBottom: 0,
            border: 'none',
            background: '#F8FAFC',
            borderRadius: '12px',
            padding: '14px 18px',
            fontSize: '15px',
            outline: 'none'
          }}
        />
        <button
          className="btn-primary"
          onClick={handleSend}
          disabled={loading}
          style={{
            width: '100px',
            borderRadius: '12px',
            background: loading
              ? '#CBD5E1'
              : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: 'none',
            color: '#FFFFFF',
            fontWeight: '600',
            fontSize: '15px',
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: loading ? 'none' : '0 4px 12px rgba(102, 126, 234, 0.3)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => !loading && (e.currentTarget.style.transform = 'translateY(-2px)')}
          onMouseLeave={(e) => !loading && (e.currentTarget.style.transform = 'translateY(0)')}
        >
          Send
        </button>
      </div>

      {/* Data Sources */}
      <div style={{
        marginTop: '16px',
        padding: '16px',
        background: '#F8FAFC',
        borderRadius: '12px',
        fontSize: '12px',
        color: '#64748B',
        display: 'flex',
        justifyContent: 'center',
        gap: '20px',
        flexWrap: 'wrap',
        border: '1px solid #E5E7EB'
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>💱</span> ExchangeRate API
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>🌤️</span> Open-Meteo
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>📰</span> NewsAPI
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>📅</span> Event DB
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>✈️</span> JNTO Stats
        </span>
      </div>

      {/* Add keyframe animation for spinning loader */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}

export default AiChatbot;