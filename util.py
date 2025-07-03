from itertools import combinations


def check_triple_loop(
    solver, work, num_employees, num_shifts, num_sessions, cover_demands
) -> int:
    for e1, e2, e3 in combinations(range(num_employees), 3):
        for s1 in range(1, num_shifts):
            for s2 in range(1, num_shifts):
                if len({s1, s2}) == 2:
                    for s3 in range(1, num_shifts):
                        if len({s1, s2, s3}) == 3:
                            for d in range(num_sessions - 1):
                                if all(
                                    cover_demands[d + i][s - 1] > 0
                                    for i in range(2)
                                    for s in (s1, s2, s3)
                                ):
                                    if (
                                        solver.Value(work[e1, s1, d])
                                        and solver.Value(work[e1, s2, d + 1])
                                        and solver.Value(work[e2, s2, d])
                                        and solver.Value(work[e2, s3, d + 1])
                                        and solver.Value(work[e3, s3, d])
                                        and solver.Value(work[e3, s1, d + 1])
                                    ):
                                        return d
    return -1


def find_in_tuple(list_of_tuples, c):
    for a, *b in list_of_tuples:
        if a == c:
            return b
        return []
