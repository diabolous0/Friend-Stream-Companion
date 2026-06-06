import { useState } from "react";
import { useLocation } from "wouter";
import { useLogin, useRegister, useGetMe, getGetMeQueryKey, setAuthTokenGetter } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Initialize auth getter
setAuthTokenGetter(() => localStorage.getItem("screencrew_token"));

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = useLogin();
  const registerMutation = useRegister();

  const handleSuccess = (token: string) => {
    localStorage.setItem("screencrew_token", token);
    setLocation("/rooms");
  };

  const onLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ data: { username, password } }, {
      onSuccess: (data) => handleSuccess(data.token),
      onError: (err) => {
        toast({ title: "Login failed", description: err.message, variant: "destructive" });
      }
    });
  };

  const onRegister = (e: React.FormEvent) => {
    e.preventDefault();
    registerMutation.mutate({ data: { username, password } }, {
      onSuccess: (data) => handleSuccess(data.token),
      onError: (err) => {
        toast({ title: "Registration failed", description: err.message, variant: "destructive" });
      }
    });
  };

  const { data: me, isLoading } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey() } });

  if (me) {
    setLocation("/rooms");
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-primary font-mono crt-scanline">INIT SYSTEM...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background crt-scanline relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background/80 to-background pointer-events-none" />
      
      <Card className="w-full max-w-sm border-primary/20 bg-background/95 backdrop-blur z-10 rounded-sm">
        <CardHeader className="text-center pb-2">
          <CardTitle className="font-mono text-3xl text-primary tracking-widest uppercase">ScreenCrew</CardTitle>
          <CardDescription className="font-mono text-xs tracking-wider text-muted-foreground">LOCAL AREA NETWORK CLIENT</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4 bg-muted/50 rounded-sm">
              <TabsTrigger value="login" className="rounded-sm font-mono text-xs uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Auth</TabsTrigger>
              <TabsTrigger value="register" className="rounded-sm font-mono text-xs uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Register</TabsTrigger>
            </TabsList>
            
            <TabsContent value="login">
              <form onSubmit={onLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username" className="font-mono text-xs text-primary/80 uppercase">Username</Label>
                  <Input 
                    id="username" 
                    value={username} 
                    onChange={e => setUsername(e.target.value)}
                    className="font-mono bg-muted/20 border-primary/20 focus-visible:ring-primary rounded-sm h-10"
                    required 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="font-mono text-xs text-primary/80 uppercase">Password</Label>
                  <Input 
                    id="password" 
                    type="password" 
                    value={password} 
                    onChange={e => setPassword(e.target.value)}
                    className="font-mono bg-muted/20 border-primary/20 focus-visible:ring-primary rounded-sm h-10"
                    required 
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full font-mono uppercase tracking-widest rounded-sm"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? "Connecting..." : "Initialize"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="register">
              <form onSubmit={onRegister} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reg-username" className="font-mono text-xs text-primary/80 uppercase">Username</Label>
                  <Input 
                    id="reg-username" 
                    value={username} 
                    onChange={e => setUsername(e.target.value)}
                    className="font-mono bg-muted/20 border-primary/20 focus-visible:ring-primary rounded-sm h-10"
                    required 
                    minLength={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-password" className="font-mono text-xs text-primary/80 uppercase">Password</Label>
                  <Input 
                    id="reg-password" 
                    type="password" 
                    value={password} 
                    onChange={e => setPassword(e.target.value)}
                    className="font-mono bg-muted/20 border-primary/20 focus-visible:ring-primary rounded-sm h-10"
                    required 
                    minLength={4}
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full font-mono uppercase tracking-widest rounded-sm"
                  disabled={registerMutation.isPending}
                >
                  {registerMutation.isPending ? "Creating..." : "Create Node"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
