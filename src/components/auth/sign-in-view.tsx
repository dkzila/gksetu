'use client'

import { navigateToPath } from '@/components/home/app-router'

/**
 * GKSetu — the sign-in / create-account page (#/signin).
 *
 * The ONE public authentication surface: a clean, focused page that
 * replaces the old "console → account section" journey for users.
 * Uses the same /api/auth endpoints as every other client (web and the
 * future app). Successful sign-in welcomes the learner on their
 * dashboard; already-signed-in visitors see their account summary
 * instead of the forms.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ArrowLeft,
  BookOpenCheck,
  GraduationCap,
  Loader2,
  LogIn,
  Newspaper,
  Sparkles,
  UserRound,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// ---------- Validation (client mirror of the API contract) ----------

const signInSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const signUpSchema = z.object({
  name: z.string().trim().max(80, 'Name is too long').optional(),
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[a-zA-Z]/, 'Must contain a letter')
    .regex(/[0-9]/, 'Must contain a number'),
})

type SignInValues = z.infer<typeof signInSchema>
type SignUpValues = z.infer<typeof signUpSchema>

// ---------- Props ----------

export interface SignInViewProps {
  onGoHome: () => void
}

// ---------- Component ----------

export function SignInView({ onGoHome }: SignInViewProps) {
  const { status, user, error, initialize, signIn, signUp, clearError } = useAuth()
  const { toast } = useToast()

  useEffect(() => {
    void initialize()
  }, [initialize])

  const signInForm = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })
  const signUpForm = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '' },
  })

  const [signInBusy, setSignInBusy] = useState(false)
  const [signUpBusy, setSignUpBusy] = useState(false)

  const welcome = (name: string | null) => {
    toast({
      title: `Welcome, ${name ?? 'learner'}!`,
      description: 'You are signed in — your dashboard is ready.',
    })
    navigateToPath('/dashboard')
  }

  async function handleSignIn(values: SignInValues) {
    setSignInBusy(true)
    const ok = await signIn(values.email, values.password)
    setSignInBusy(false)
    if (ok) {
      clearError()
      welcome(signInForm.getValues('email').split('@')[0] ?? null)
    }
  }

  async function handleSignUp(values: SignUpValues) {
    setSignUpBusy(true)
    const ok = await signUp({
      email: values.email,
      password: values.password,
      name: values.name?.trim() ? values.name.trim() : undefined,
    })
    setSignUpBusy(false)
    if (ok) {
      clearError()
      welcome(values.name?.trim() || null)
    }
  }

  const resolved = status === 'authenticated' && user !== null
  const loading = status === 'loading' || status === 'idle'

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 text-zinc-500 hover:text-zinc-900"
        onClick={onGoHome}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to home
      </Button>

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-2" aria-busy="true" aria-label="Loading your account">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : resolved ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <Card className="mx-auto max-w-lg border-zinc-200 shadow-sm">
            <CardContent className="space-y-5 p-8 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50" aria-hidden="true">
                <UserRound className="h-7 w-7 text-emerald-600" />
              </span>
              <div className="space-y-1">
                <h1 className="text-xl font-bold tracking-tight text-zinc-900">
                  You&rsquo;re signed in
                </h1>
                <p className="text-sm text-zinc-500">
                  {user.name ? `${user.name} · ` : ''}
                  {user.email}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button asChild className="bg-emerald-600 text-white hover:bg-emerald-700">
                  <a href="/dashboard">Go to your dashboard</a>
                </Button>
                <Button asChild variant="outline">
                  <a href="/">Browse GKSetu</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="grid overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm lg:grid-cols-2"
        >
          {/* Brand / value panel */}
          <div className="relative hidden flex-col justify-between bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 p-10 text-white lg:flex">
            <div>
              <h2 className="text-2xl font-bold leading-tight">
                Learn smarter, every day.
              </h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-emerald-50/90">
                A free account keeps your learning in one place — across
                every topic, exam and language you use.
              </p>
            </div>
            <ul className="space-y-4" role="list">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15" aria-hidden="true">
                  <BookOpenCheck className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Build your library</p>
                  <p className="text-sm text-emerald-50/80">
                    Save any topic or story to your collections.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15" aria-hidden="true">
                  <GraduationCap className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Follow your exams</p>
                  <p className="text-sm text-emerald-50/80">
                    A personal dashboard with your revision queue.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15" aria-hidden="true">
                  <Newspaper className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Never miss an update</p>
                  <p className="text-sm text-emerald-50/80">
                    Get notified when followed topics change.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15" aria-hidden="true">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Practice that adapts</p>
                  <p className="text-sm text-emerald-50/80">
                    Quick mock tests built from what you follow.
                  </p>
                </div>
              </li>
            </ul>
            <p className="text-xs text-emerald-50/70">
              Your data stays yours — review or delete it anytime from Settings.
            </p>
          </div>

          {/* Forms panel */}
          <div className="p-6 sm:p-10">
            <h1 className="text-xl font-bold tracking-tight text-zinc-900">
              Welcome to GKSetu
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Sign in to continue — or create a free account in seconds.
            </p>

            <Tabs defaultValue="signin" className="mt-6">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>

              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {error}
                </p>
              )}

              <TabsContent value="signin" className="mt-5">
                <Form {...signInForm}>
                  <form onSubmit={signInForm.handleSubmit(handleSignIn)} className="space-y-4" noValidate>
                    <FormField
                      control={signInForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={signInForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" autoComplete="current-password" placeholder="Your password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700" disabled={signInBusy}>
                      {signInBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
                      Sign in
                    </Button>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="signup" className="mt-5">
                <Form {...signUpForm}>
                  <form onSubmit={signUpForm.handleSubmit(handleSignUp)} className="space-y-4" noValidate>
                    <FormField
                      control={signUpForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name (optional)</FormLabel>
                          <FormControl>
                            <Input autoComplete="name" placeholder="Your name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={signUpForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={signUpForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              autoComplete="new-password"
                              placeholder="8+ characters, a letter and a number"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700" disabled={signUpBusy}>
                      {signUpBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      Create free account
                    </Button>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>

            <p className="mt-6 text-center text-xs leading-relaxed text-zinc-400">
              By continuing you agree to use GKSetu honestly — one account per
              learner. Your email is never shared.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  )
}
