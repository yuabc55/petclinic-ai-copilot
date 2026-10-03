"""Appointment BFF contracts using synthetic test data; no Java or model calls."""

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import demo_petclinic_business_api as business


VET = {"id": 7, "firstName": "Test", "lastName": "Veterinarian"}
APPOINTMENT = {"id": 42, "petId": 3, "vetId": 7, "startAt": "2020-02-29T10:15:00Z",
               "status": "REQUESTED", "createdAt": "2020-02-28T18:30:00+05:30", "version": 0}
PATHS = ("/api/vets", "/api/vets/7/appointments", "/api/appointments/42")


class AppointmentBusinessAPITests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(business.router)
        self.client = TestClient(app)
        self.http = patch.object(business, "request_json").start()
        self.addCleanup(patch.stopall)
        self.addCleanup(self.client.close)

    def respond(self, data):
        self.http.return_value = {"ok": True, "status": 200, "data": data}

    def test_vet_directory_filters_fields_and_forwards_get(self):
        self.respond([{**VET, "specialties": [{"id": 1, "name": "test"}]}])
        response = self.client.get(PATHS[0])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [VET])
        self.http.assert_called_once_with("GET", "/vets", allow_list=True)

    def test_list_and_detail_forward_exact_paths_and_preserve_complete_records(self):
        for path, data, many in ((PATHS[1], [APPOINTMENT], True), (PATHS[2], APPOINTMENT, False)):
            with self.subTest(path=path):
                self.http.reset_mock()
                self.respond(data)
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), data)
                if many:
                    self.http.assert_called_once_with("GET", path.removeprefix("/api"), allow_list=True)
                else:
                    self.http.assert_called_once_with("GET", path.removeprefix("/api"))

    def test_four_statuses_and_historical_offset_times_are_valid(self):
        for status in ("REQUESTED", "CONFIRMED", "CANCELLED", "COMPLETED"):
            with self.subTest(status=status):
                record = {**APPOINTMENT, "status": status, "startAt": "2001-01-01T10:15:00-04:00"}
                self.respond(record)
                response = self.client.get(PATHS[2])
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), record)

    def test_empty_lists_are_successful(self):
        for path in PATHS[:2]:
            with self.subTest(path=path):
                self.respond([])
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), [])

    def test_upstream_http_errors_keep_status_and_hide_diagnostics(self):
        for path in PATHS:
            for status in (401, 403, 404, 500, 502, 503):
                with self.subTest(path=path, status=status):
                    self.http.return_value = {"ok": False, "status": status, "error": "http_error",
                                              "detail": "private host and credentials"}
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, status)
                    self.assertEqual(response.json(), {"detail": "PetClinic could not complete this query."})

    def test_connection_and_non_json_errors_are_502(self):
        for path in PATHS:
            for error, status in (("connection_failure", None), ("invalid_response", 200)):
                with self.subTest(path=path, error=error):
                    self.http.return_value = {"ok": False, "status": status, "error": error, "detail": "private"}
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, 502)
                    self.assertNotIn("private", response.text)

    def test_list_shapes_and_bad_elements_are_502(self):
        for path in PATHS[:2]:
            for data in (None, {}, "[]", [None], [1], [[]]):
                with self.subTest(path=path, data=data):
                    self.respond(data)
                    self.assertEqual(self.client.get(path).status_code, 502)

    def test_detail_shapes_are_502(self):
        for data in (None, [], "{}", {}):
            with self.subTest(data=data):
                self.respond(data)
                self.assertEqual(self.client.get(PATHS[2]).status_code, 502)

    def test_invalid_ids_versions_and_statuses_are_502(self):
        mutations = [(field, value) for field in ("id", "petId", "vetId")
                     for value in (True, "42", 0, -1, 1.5, 2147483648)]
        mutations += [("version", value) for value in (True, "0", -1, 0.5, 9223372036854775808)]
        mutations += [("status", value) for value in ("UNKNOWN", "requested", None, 0)]
        for field, value in mutations:
            for path in PATHS[1:]:
                with self.subTest(field=field, value=value, path=path):
                    record = {**APPOINTMENT, field: value}
                    self.respond([record] if path == PATHS[1] else record)
                    self.assertEqual(self.client.get(path).status_code, 502)

    def test_missing_fields_are_502(self):
        for field in APPOINTMENT:
            with self.subTest(field=field):
                self.respond({key: value for key, value in APPOINTMENT.items() if key != field})
                self.assertEqual(self.client.get(PATHS[2]).status_code, 502)

    def test_dates_must_be_valid_iso_strings_with_offsets(self):
        values = (0, 1700000000, "1700000000", True, None, "invalid", "2020-01-01",
                  "2020-01-01T10:00:00", "2021-02-29T10:00:00Z", "2020-13-01T10:00:00Z",
                  "2020-01-01T24:00:00Z", "2020-01-01T10:00:00+99:00")
        for field in ("startAt", "createdAt"):
            for value in values:
                with self.subTest(field=field, value=value):
                    self.respond({**APPOINTMENT, field: value})
                    self.assertEqual(self.client.get(PATHS[2]).status_code, 502)

    def test_invalid_vet_names_and_ids_are_502(self):
        for field, values in (("id", (True, "7", 0, 2147483648)),
                              ("firstName", (None, 1, "", " \t")), ("lastName", (None, False, "", " "))):
            for value in values:
                with self.subTest(field=field, value=value):
                    self.respond([{**VET, field: value}])
                    self.assertEqual(self.client.get(PATHS[0]).status_code, 502)
        self.respond([{"id": 7, "firstName": "Test"}])
        self.assertEqual(self.client.get(PATHS[0]).status_code, 502)

    def test_duplicate_and_mismatched_ids_are_502(self):
        for path, data in ((PATHS[0], [VET, VET]), (PATHS[1], [APPOINTMENT, APPOINTMENT]),
                           (PATHS[1], [{**APPOINTMENT, "vetId": 8}]),
                           (PATHS[2], {**APPOINTMENT, "id": 43})):
            with self.subTest(path=path):
                self.respond(data)
                self.assertEqual(self.client.get(path).status_code, 502)

    def test_invalid_path_ids_do_not_reach_java(self):
        for id_value in ("0", "-1", "2147483648", "abc", "1.5", "true"):
            for path in (f"/api/vets/{id_value}/appointments", f"/api/appointments/{id_value}"):
                with self.subTest(path=path):
                    self.assertEqual(self.client.get(path).status_code, 422)
        self.http.assert_not_called()

    def test_write_methods_and_agent_actions_are_not_exposed(self):
        for path in PATHS:
            for method in ("post", "put", "patch", "delete"):
                with self.subTest(path=path, method=method):
                    self.assertEqual(getattr(self.client, method)(path).status_code, 405)
        for action in ("cancel", "confirm"):
            for method in ("get", "post", "put", "patch", "delete"):
                self.assertIn(getattr(self.client, method)(f"/api/appointments/42/{action}").status_code, (404, 405))
        self.http.assert_not_called()


if __name__ == "__main__":
    unittest.main()
