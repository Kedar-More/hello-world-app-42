import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, conversationId } = await req.json();

    if (!message) {
      throw new Error("Message is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!supabaseUrl || !supabaseKey || !lovableApiKey) {
      throw new Error("Missing required environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    const { data: previousMessages } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(10);

    const messages = [];

    let systemPrompt = `You are CareerPath AI, a knowledgeable and friendly career advisor. Your goal is to help users explore career paths, educational opportunities, skill development, and provide practical career advice.

Key responsibilities:
- Suggest career paths based on user skills, interests, and goals
- Recommend relevant courses, certifications, and educational programs
- Provide insights on job market trends, salary expectations, and career growth
- Offer resume writing tips and interview preparation advice
- Map user skills to potential career opportunities
- Give motivational and encouraging guidance
- Ask clarifying questions to better understand user needs

Guidelines:
- Be conversational, supportive, and professional
- Provide specific, actionable advice
- Ask follow-up questions to personalize recommendations
- Consider the user's experience level and background
- Keep responses clear and well-structured`;

    if (profile) {
      systemPrompt += `\n\nUser Profile:
- Name: ${profile.full_name || "Not provided"}
- Experience Level: ${profile.experience_level || "Not specified"}
- Education: ${profile.education || "Not provided"}
- Skills: ${profile.skills?.join(", ") || "Not specified"}
- Interests: ${profile.interests?.join(", ") || "Not specified"}
- Career Goals: ${profile.career_goals || "Not specified"}

Use this information to personalize your advice.`;
    }

    messages.push({ role: "system", content: systemPrompt });

    if (previousMessages && previousMessages.length > 0) {
      messages.push(...previousMessages);
    }

    messages.push({ role: "user", content: message });

    console.log("Sending request to Lovable AI Gateway");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI service unavailable. Please contact support." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      throw new Error(`AI Gateway error: ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const responseText = aiData.choices?.[0]?.message?.content;

    if (!responseText) {
      throw new Error("No response from AI");
    }

    console.log("AI response received successfully");

    return new Response(
      JSON.stringify({ response: responseText }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Chat function error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
