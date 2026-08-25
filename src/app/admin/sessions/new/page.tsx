import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { CreateSessionForm } from "./create-session-form";

export default async function NewCotisationPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/dashboard");
  const lang = await getLang();
  const t = getTranslator(lang);

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-xl mx-auto">
      <h1 className="font-title-md text-title-md text-primary mb-stack-gap-md">{t("newCotisation")}</h1>
      <CreateSessionForm lang={lang} />
    </main>
  );
}
