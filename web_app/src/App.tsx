import { useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import { BootLoader } from "@/components/BootLoader";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [isBooting, setIsBooting] = useState(true);

  return (
    <ThemeProvider defaultTheme="light" storageKey="ares-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {isBooting ? (
            <BootLoader onComplete={() => setIsBooting(false)} />
          ) : null}
          <div className="flex flex-col h-screen w-screen overflow-hidden bg-background">
            <div className="flex-1 overflow-hidden">
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <Router />
              </WouterRouter>
            </div>
          </div>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;