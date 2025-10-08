import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2 } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export default function Chat() {
  const [user, setUser] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        navigate("/auth");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    const initConversation = async () => {
      if (!user) return;

      const { data: conversations } = await supabase
        .from("conversations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);

      if (conversations && conversations.length > 0) {
        setConversationId(conversations[0].id);
        loadMessages(conversations[0].id);
      } else {
        const { data: newConv } = await supabase
          .from("conversations")
          .insert({ user_id: user.id })
          .select()
          .single();
        
        if (newConv) {
          setConversationId(newConv.id);
        }
      }
    };

    initConversation();
  }, [user]);

  const loadMessages = async (convId: string) => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });

    if (data) {
      setMessages(data as Message[]);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !conversationId || loading) return;

    const userMessage = input.trim();
    setInput("");
    setLoading(true);

    try {
      const { data: userMsg, error: userError } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "user",
          content: userMessage,
        })
        .select()
        .single();

      if (userError) throw userError;

      setMessages((prev) => [...prev, userMsg as Message]);

      const { data, error } = await supabase.functions.invoke("chat", {
        body: {
          message: userMessage,
          conversationId,
        },
      });

      if (error) {
        throw error;
      }

      const { data: assistantMsg, error: assistantError } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "assistant",
          content: data.response,
        })
        .select()
        .single();

      if (assistantError) throw assistantError;

      setMessages((prev) => [...prev, assistantMsg as Message]);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send message",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar user={user} />
      <div className="container mx-auto px-4 pt-20 pb-4 h-screen flex flex-col max-w-4xl">
        <div className="flex-1 overflow-y-auto space-y-4 mb-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
              <div className="text-4xl">👋</div>
              <h2 className="text-2xl font-bold">Welcome to CareerPath AI</h2>
              <p className="text-muted-foreground max-w-md">
                I'm your personal career advisor. Ask me about career paths, educational programs, 
                skill development, or any career-related questions!
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <Card
                key={message.id}
                className={`p-4 ${
                  message.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground max-w-[80%]"
                    : "mr-auto bg-card max-w-[80%]"
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
              </Card>
            ))
          )}
          {loading && (
            <Card className="p-4 mr-auto bg-card max-w-[80%]">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </Card>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask me about your career path..."
            className="min-h-[60px] max-h-[200px]"
            disabled={loading}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            size="icon"
            className="h-[60px] w-[60px]"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
