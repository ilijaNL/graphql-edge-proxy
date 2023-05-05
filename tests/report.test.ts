import tap from 'tap';
import { createInitialReport, finishReport } from '../src/report';

tap.test('correctly creates report', async (tap) => {
  {
    const initReport = createInitialReport('query me { me }', {});
    const report = finishReport(initReport, { errors: [], data: {} });

    tap.same(report.args, []);
    tap.same(report.exec.ok, true);
    tap.same(report.exec.errs, []);
  }

  {
    const initReport = createInitialReport('query me { me }', { a: { b: { c: true }, d: [] }, b: [] });
    const report = finishReport(initReport, { errors: [], data: {} });

    tap.same(report.args, ['a', 'b', 'a.b', 'a.d', 'a.b.c']);
    tap.same(report.exec.ok, true);
    tap.same(report.exec.errs, []);
  }

  {
    const initReport = createInitialReport('query me { me }', { d: 'works', b: [] });
    const report = finishReport(initReport, { data: {} });

    tap.same(report.args, ['d', 'b']);
    tap.equal(report.exec.ok, true);
    tap.same(report.exec.errs, []);
  }

  {
    const initReport = createInitialReport('query me { me }', { d: 'works', b: [] });
    const report = finishReport(initReport, { errors: [{ message: 'abc', path: ['a', 'b', 'd'] }] });

    tap.same(report.args, ['d', 'b']);
    tap.equal(report.exec.ok, false);
    tap.same(report.exec.errs, [{ message: 'abc', path: 'a.b.d' }]);
  }

  {
    const initReport = createInitialReport('query me { me }', { d: 'works', b: [] });
    const report = finishReport(initReport, { errors: [{ message: 'ddd' }] });

    tap.same(report.args, ['d', 'b']);
    tap.equal(report.exec.ok, false);
    tap.same(report.exec.errs, [{ message: 'ddd', path: undefined }]);
  }
});
