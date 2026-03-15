<?php

namespace App\Controllers;

use App\Models\User;
use App\Services\UserService;
use App\Exceptions\UserNotFoundException;

class UserController
{
    private UserService $userService;

    public function __construct(UserService $userService)
    {
        $this->userService = $userService;
    }

    public function show(int $id): User
    {
        try {
            return $this->userService->findUser($id);
        } catch (UserNotFoundException $e) {
            throw $e;
        }
    }

    public function store(string $name, ?string $email = null): User
    {
        return $this->userService->createUser($name, $email);
    }
}
