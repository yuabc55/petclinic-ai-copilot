"""Read-only BFF contract tests, independent of model credentials and checkpoints."""

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import demo_petclinic_business_api as business


PET = {"id": 1, "name": "test-pet", "birthDate": "2020-09-07",
       "type": {"id": 1, "name": "cat"}, "ownerId": 1}


class PetBusinessAPITests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(business.router)
        self.client = TestClient(app)
        self.http = patch.object(business, "request_json").start()
        self.addCleanup(patch.stopall)
        self.addCleanup(self.client.close)

    def respond(self, data):
        self.http.return_value = {"ok": True, "status": 200, "data": data}

    def test_list_and_empty_array_use_explicit_list_response(self):
        self.respond([PET])
        response = self.client.get("/api/pets")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [PET])
        self.http.assert_called_once_with("GET", "/pets", allow_list=True)
        self.respond([])
        self.assertEqual(self.client.get("/api/pets").json(), [])

    def test_details_and_owner_keep_real_ids_and_only_requested_fields(self):
        self.respond({**PET, "visits": []})
        self.assertEqual(self.client.get("/api/pets/1").json(), PET)
        self.http.assert_called_once_with("GET", "/pets/1")
        self.http.reset_mock()
        owner = {"id": 1, "firstName": "test", "lastName": "owner"}
        self.respond({**owner, "telephone": "not-exposed", "pets": [PET]})
        self.assertEqual(self.client.get("/api/owners/1").json(), owner)
        self.http.assert_called_once_with("GET", "/owners/1")

    def test_upstream_errors_are_preserved_and_never_become_empty_lists(self):
        for status in (401, 403, 404, 500, 503):
            with self.subTest(status=status):
                self.http.return_value = {"ok": False, "status": status, "error": "http_error"}
                response = self.client.get("/api/pets")
                self.assertEqual(response.status_code, status)
                self.assertIn("detail", response.json())
        for status in (None, 200):
            self.http.return_value = {"ok": False, "status": status, "error": "invalid_response"}
            self.assertEqual(self.client.get("/api/pets").status_code, 502)

    def test_invalid_records_or_mismatched_ids_are_502(self):
        for data in ({}, [None], [{**PET, "birthDate": "invalid"}], [{**PET, "id": True}]):
            with self.subTest(data=data):
                self.respond(data)
                self.assertEqual(self.client.get("/api/pets").status_code, 502)
        self.respond({**PET, "id": 2})
        self.assertEqual(self.client.get("/api/pets/1").status_code, 502)
        self.respond({"id": 2, "firstName": "test", "lastName": "owner"})
        self.assertEqual(self.client.get("/api/owners/1").status_code, 502)

    def test_invalid_ids_and_write_methods_never_reach_java(self):
        for path in ("/api/pets/0", "/api/pets/-1", "/api/pets/2147483648", "/api/owners/0"):
            self.assertEqual(self.client.get(path).status_code, 422)
        for method in ("post", "put", "patch", "delete"):
            self.assertEqual(getattr(self.client, method)("/api/pets/1").status_code, 405)
        self.http.assert_not_called()


if __name__ == "__main__":
    unittest.main()
