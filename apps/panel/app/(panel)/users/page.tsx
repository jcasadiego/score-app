import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import { listUsers, type PaginatedUsers } from "@/lib/api/users";
import { ApiError } from "@/lib/api/errors";
import { PageError } from "@/components/page-error";
import { PAGE_SIZE } from "@/lib/users/limits";
import { UsersScreen } from "@/components/users/users-screen";
import {
  TEST_SCENARIOS,
  testPage,
  type TestScenario,
} from "@/components/users/users-test-data";
import { TestDataSelector } from "@/components/users/test-data-selector";

export const metadata: Metadata = {
  title: "Usuarios · Panel SCORE",
};

const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

function testScenarioFrom(value: unknown): TestScenario | undefined {
  if (!IS_DEVELOPMENT) return undefined;
  return TEST_SCENARIOS.find((e) => e === value);
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function UsersPage({
  searchParams,
}: PageProps<"/users">) {
  const session = await verifySession();
  const params = await searchParams;

  const requestedPage = Number(firstValue(params.page));
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const q = firstValue(params.q)?.trim().slice(0, 100) || undefined;
  const filter = { page, pageSize: PAGE_SIZE, search: q };

  const scenario = testScenarioFrom(firstValue(params.data));

  let result: PaginatedUsers;
  if (scenario) {
    result = testPage(scenario, session.id, filter);
  } else {
    const token = await getToken();
    try {
      if (!token) {
        throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
      }
      result = await listUsers(token, filter);
    } catch (error) {
      return <PageError error={error} fallback="No pudimos cargar los usuarios. Intenta de nuevo." />;
    }
  }

  return (
    <>
      <UsersScreen
        page={result}
        search={q ?? ""}
        currentUserId={session.id}
      />
      {IS_DEVELOPMENT && <TestDataSelector current={scenario} />}
    </>
  );
}
